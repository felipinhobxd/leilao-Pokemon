// Instala o servico local de reconhecimento (venv + modelos + catalogo + indice).
import { recognitionLauncher } from "./recognition-shared.mjs";
await recognitionLauncher("install");
