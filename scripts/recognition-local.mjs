// Sobe o servico local de reconhecimento (127.0.0.1:8765, modelos carregados).
import { recognitionLauncher } from "./recognition-shared.mjs";
await recognitionLauncher("local");
