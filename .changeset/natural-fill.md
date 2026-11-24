---
'@modelform/react-native': minor
---

The rule-based filler understands more natural speech

- Field names match the forms they're said in ("slept", "weighed", "meditation") and a few everyday synonyms ("drink" for Alcohol, "jog" for Run, "bike" for Ride, "feeling" for Mood).
- A named field takes only the value next to it ("slept badly, maybe five hours"), so the rest of what was said is left for other fields.
- Toggles: "didn't drink", "no meditation" and "skipped the gym" are no; saying a toggle's own name ("I meditated") is yes. A synonym on its own never means yes.
- Ratings in words when the field is named: "mood pretty low", "in a good mood", "effort hard".
- Times convert to the field's unit ("an hour and a half" in a minutes field is 90), "5k" and "72kg" are read, and a unit that doesn't fit ("160 pounds" for a kg field) is left out.
- **Changed:** when a field is named twice, the last value now wins ("mood 3, no wait, mood 4" → 4); before, the first did. "Actually" and "sorry" work the same way.
- `parseSpokenDuration` reads "half an hour", "a quarter of an hour" and "three quarters of an hour". Before, "half an hour" came out as an hour.

On the fill test cases it now gets 41 of 45 fields right, up from 31, and still none wrong.
