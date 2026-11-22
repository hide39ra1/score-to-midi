"""Test pipeline helpers without downloading the inference runtime or models."""
import ast
from pathlib import Path
import re
import unittest
import xml.etree.ElementTree as ET
from types import SimpleNamespace

source = ast.parse(Path('src/py/pipeline.py').read_text(encoding='utf-8'))
helpers = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in {'_match_noteheads', '_recover_missing_staffs'}]
scope = {}
exec(compile(ast.Module(body=helpers, type_ignores=[]), 'pipeline-helpers', 'exec'), scope)


class RecoveryTests(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
