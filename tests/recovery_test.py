"""Test pipeline helpers without downloading the inference runtime or models."""
import ast
from pathlib import Path
import re
import json
import unittest
import xml.etree.ElementTree as ET
from types import SimpleNamespace

source = ast.parse(Path('src/py/pipeline.py').read_text(encoding='utf-8'))
helpers = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in {'_match_noteheads', '_fold_boundary_only_measures', '_recover_missing_staffs','_align_part_slots','_merge_full_score_pages'}]
scope = {}
exec(compile(ast.Module(body=helpers, type_ignores=[]), 'pipeline-helpers', 'exec'), scope)


class RecoveryTests(unittest.TestCase):
    def test_missing_middle_staff_does_not_shift_later_instruments(self):
        align=scope['_align_part_slots']
        self.assertEqual(align([(0,1),(.5,1),(1,1)],[(0,1),(1,1)]),{0:0,2:1})
        self.assertEqual(align([(0,1),(.5,2),(1,1)],[(0,1),(.5,2),(1,1)]),{0:0,1:1,2:2})

    def test_page_merge_preserves_part_identity_when_a_staff_is_missing(self):
        scope.update(ET=ET,re=re,json=json,np=SimpleNamespace(median=lambda values:sorted(values)[len(values)//2]))
        def score(items,page):
            root=ET.Element('score-partwise');lst=ET.SubElement(root,'part-list')
            for i,(y,step) in enumerate(items,1):
                meta=ET.SubElement(lst,'score-part',id=f'P{i}');ET.SubElement(meta,'part-name').text=step
                part=ET.SubElement(root,'part',id=f'P{i}');measure=ET.SubElement(part,'measure',number='1');note=ET.SubElement(measure,'note',id=f'n{i}-p{page}-100-{y}')
                pitch=ET.SubElement(note,'pitch');ET.SubElement(pitch,'step').text=step;ET.SubElement(pitch,'octave').text='4';ET.SubElement(note,'duration').text='4'
            return root
        geometry={'staves':[{'top':y-10,'bottom':y+10} for y in [100,200,300]]}
        merged=scope['_merge_full_score_pages']([(score([(100,'C'),(200,'D'),(300,'E')],0),geometry),(score([(100,'F'),(300,'G')],1),geometry)])
        parts=merged.findall('part')
        self.assertEqual(parts[2].findall('measure')[1].findtext('.//step'),'G')
        self.assertIsNone(parts[1].findall('measure')[1].find('.//pitch'))
        self.assertEqual(parts[1].findall('measure')[1].find('note').get('print-object'),'no')
        self.assertIn('認識欠落',parts[1].findall('measure')[1].findtext('.//words'))
        ranges=json.loads(merged.find("identification/miscellaneous/miscellaneous-field[@name='page-measures-v1']").text)
        self.assertEqual(ranges,[{'page':0,'start':0,'count':1},{'page':1,'start':1,'count':1}])

    def test_boundary_only_phantom_measure_preserves_ending_and_repeat(self):
        scope.update(ET=ET)
        root=ET.fromstring('<score-partwise><part id="P1"><measure number="1"><note id="a"><rest/><duration>4</duration></note><barline location="right"><repeat direction="backward"/></barline></measure><measure number="2"><barline location="right"><ending type="stop" number="1"/></barline></measure><measure number="3"><note id="b"><rest/><duration>4</duration></note></measure></part></score-partwise>')
        result=scope['_fold_boundary_only_measures'](root,{'staves':[{'measureCount':2}]})
        self.assertEqual(len(result),1)
        self.assertEqual([n.get('id') for n in root.iter('note')],['a','b'])
        self.assertEqual(len(root.findall('part/measure')),2)
        self.assertEqual([c.tag for c in root.find('part/measure/barline')],['ending','repeat'])
        self.assertEqual(root.findall('part/measure')[1].get('number'),'2')
        # An actual rest measure must never be erased to fit a count.
        self.assertEqual(scope['_fold_boundary_only_measures'](root,{'staves':[{'measureCount':1}]}),[])

    def test_coordinates_snap_to_unique_heads_without_changing_notes(self):
        match = scope['_match_noteheads']
        self.assertEqual(match([(10, 12), (30, 20)], [(11, 10), (31, 21)], 10), {0: 0, 1: 1})
        self.assertEqual(match([(10, 10)], [(9, 10), (11, 10)], 10), {})
        self.assertEqual(len(match([(10, 10), (11, 10)], [(10, 10)], 10)), 1)
        self.assertEqual(match([(10, 10)], [(50, 50)], 10), {})

    def test_retry_inserts_the_missing_part_in_vertical_order_with_unique_ids(self):
        def xml(y):
            return ET.fromstring(f'<score-partwise><part-list><score-part id="P1"><part-name>Voice</part-name><score-instrument id="I1"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="I1"><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id="P1"><measure number="1"><note id="n1-p0-100-{y}"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>')
        class Image:
            shape = (400, 400)
            def __getitem__(self, key): return self
        scope.update(cv2=SimpleNamespace(imread=lambda _: Image(), imwrite=lambda *args: None),
                     _read_page=lambda *args: (xml(30), [[10, 20, 200, 40, 0]]),
                     _recognition_review=[], _page=0, re=re,
                     np=SimpleNamespace(median=lambda values: sorted(values)[len(values)//2]),
                     os=SimpleNamespace(remove=lambda _: None))
        root = xml(50)
        boxes = [[10, 30, 200, 70, 0]]
        staves = [{'id':1,'top':30,'bottom':70,'left':10,'right':200,'spacing':10},
                  {'id':2,'top':200,'bottom':240,'left':10,'right':200,'spacing':10}]
        result = scope['_recover_missing_staffs'](root, boxes, 'input', {'staves':staves})
        self.assertEqual(result[0]['staff'], 2)
        self.assertEqual([p.get('id') for p in root.findall('part')], ['P1', 'P2'])
        self.assertEqual([p.get('id') for p in root.findall('part-list/score-part/score-instrument')], ['P1-I1', 'P2-I1'])
        self.assertEqual(root.findall('part')[1].find('.//note').get('id'), 'n1-p0-100-165')
        self.assertEqual(len(boxes), 2)
        root_with_empty_detection=xml(50)
        detected_boxes=[[10,30,200,70,0],[10,200,200,240,0]]
        result=scope['_recover_missing_staffs'](root_with_empty_detection,detected_boxes,'input',{'staves':staves})
        self.assertEqual(result[0]['staff'],2)
        self.assertEqual(len(root_with_empty_detection.findall('part')),2)
        self.assertEqual(len(detected_boxes),2)
        # A staff may exist, yet its first measure can have been read in the
        # next physical bar (the reported tenor-saxophone regression).
        root=xml(50);root.find('.//note').set('id','n1-p0-230-50')
        current={'id':1,'top':30,'bottom':70,'left':10,'right':250,'spacing':10,'boundaries':[10,150,250]}
        result=scope['_recover_missing_staffs'](root,[[10,30,250,70,0]],'input',{'staves':[current]})
        self.assertTrue(result[0]['replaced'])
        self.assertEqual(result[0]['firstMeasureFit'],1)
        self.assertEqual(result[0]['addedNotes'],0)
        self.assertEqual(len(root.findall('part')),1)
        # Later bars can drift even when the first bar fits perfectly.
        def three_bars(xs):
            root=xml(50);part=root.find('part');part.remove(part.find('measure'))
            for i,x in enumerate(xs):
                measure=ET.SubElement(part,'measure',number=str(i+1))
                note=ET.SubElement(measure,'note',id=f'n{i}-p0-{x}-50')
                pitch=ET.SubElement(note,'pitch');ET.SubElement(pitch,'step').text='C'
                ET.SubElement(pitch,'octave').text='4';ET.SubElement(note,'duration').text='1'
            return root
        current.update(right=350,boundaries=[10,150,250,350],measureCount=3)
        scope['_read_page']=lambda *args:(three_bars([100,200,300]),[[10,30,350,70,0]])
        root=three_bars([100,230,230])
        result=scope['_recover_missing_staffs'](root,[[10,30,350,70,0]],'input',{'staves':[current]})
        self.assertTrue(result[0]['replaced'])
        self.assertEqual(result[0]['measureFit'],1)



if __name__ == '__main__':
    unittest.main()
