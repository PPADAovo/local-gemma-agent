import unittest
import feedback_training as training

class RatingsTest(unittest.TestCase):
    def test_only_liked_pairs(self):
        turns = [dict(role="user", content="A"), dict(role="assistant", content="B"),
                 dict(role="user", content="C"), dict(role="assistant", content="D")]
        self.assertEqual(list(training.liked_pairs(turns, {"0":"별로예요", "1":"좋아요"})), [("C","D")])
