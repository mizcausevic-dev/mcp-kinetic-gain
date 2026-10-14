# Synthetic aviation contract fixtures

These are fictional test inputs, not aircraft, maintenance, or certification records.
The files below were copied byte-for-byte from
[`aviation-ml-assurance-card-spec`](https://github.com/mizcausevic-dev/aviation-ml-assurance-card-spec)
main commit `e90bc740afa8588431d6be51b8667ef32e414557`.
The MRO signature profile is specified by
[`mro-ai-signoff-card-spec`](https://github.com/mizcausevic-dev/mro-ai-signoff-card-spec)
main commit `09095ea2bd1c0abd9fe8454be743711fcc835912`.

| Local file | Source path in Aviation repo | SHA-256 |
| --- | --- | --- |
| `aviation-golden-card.json` | `examples/golden-packet/aviation-card.json` | `f78ebe4a369bd2c02dde20fc7cbda0710392078c9c33f9b4b4fc8872f30cd6b` |
| `aviation-golden-mro-card.json` | `examples/golden-packet/mro-card.json` | `8beb86faeb28eba4084012ac607f32cb449afbf3ff15ec7cd89ac57a25156e95` |
| `aviation-golden-mro-public-key.pub` | `examples/golden-packet/mro-public-key.pub` | `001b9da80fa3c7eee88e4d916b8ab0de22c3cc8415a3ac6b2fb99eac7dbef3a5` |
| `aviation-golden-observation.json` | `examples/golden-packet/synthetic-observation.json` | `48ec03319a4a3905c41b09cacd6c0e4fa0c1d94489786c475110ff8050aa0af6` |

The source files are MIT-licensed. The copyright and permission notice is in
[`AVIATION-MIT-LICENSE.txt`](AVIATION-MIT-LICENSE.txt). The public key is a test
key; no private key is included.
