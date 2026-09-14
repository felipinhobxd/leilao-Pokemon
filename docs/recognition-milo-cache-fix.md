# Milo asset cache mismatch fix

The v10 browser runtime previously reused the unversioned Cache Storage namespace `leilao-card-recognition-milo-v1`. If an older metadata file and a newer binary index were cached together, the runtime could fail with `Índice Milo incompatível com os metadados.` even though the repository assets themselves were valid.

The runtime now versions model/index/metadata/stats URLs together, deletes the legacy cache, validates the published `cardsIndexed`, `embeddingDimension`, and index byte length, and forces one fresh reload before failing.
