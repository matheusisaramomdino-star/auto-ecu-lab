/** Registro distribuído com o aplicativo: novos módulos chegam pelo mesmo site. */
export const APP_VERSION = "2.2.0";
export const APP_MODULES = Object.freeze([
  {
    id: "analise",
    icon: "activity",
    label: "Análise de resposta",
    short: "Análise",
    description:
      "Gráficos de pedal, borboleta e RPM, com origem e resolução da aquisição.",
  },
  {
    id: "conexoes",
    icon: "plug",
    label: "Conexões e scanners",
    short: "Conectar",
    description:
      "Consultas de leitura com adaptador documentado e seleção explícita.",
  },
  {
    id: "veiculos",
    icon: "car",
    label: "Veículos e ECU",
    short: "Veículos",
    description:
      "Cadastros e identificação da ECU, sem inferir cobertura pelo modelo.",
  },
  {
    id: "importar",
    icon: "upload",
    label: "Importar dados",
    short: "Importar",
    description: "Arquivos CSV de parâmetros e relatórios DTC.",
  },
  {
    id: "simulador",
    icon: "sliders",
    label: "Simulador",
    short: "Simular",
    description: "Modelos matemáticos separados de qualquer operação real.",
  },
  {
    id: "relatorios",
    icon: "file",
    label: "Relatórios e backup",
    short: "Relatórios",
    description:
      "Resultados e cópia dos registros locais para guardar ou transferir.",
  },
  {
    id: "sistema",
    icon: "refresh",
    label: "Sistema e atualizações",
    short: "Sistema",
    description:
      "Atualizações no mesmo ícone, preferências e histórico de melhorias.",
  },
  {
    id: "base",
    icon: "database",
    label: "Base real e estatísticas",
    short: "Base",
    navigation: false,
    description:
      "Medições locais com origem documentada, exclusões e estatísticas por veículo e ECU compatíveis.",
  },
]);
export const DEFAULT_FAVORITES = Object.freeze([
  "conexoes",
  "analise",
  "relatorios",
]);
export function validModule(id) {
  return APP_MODULES.some((module) => module.id === id);
}

/** Fingerprint local: nenhum valor de formulário é enviado ao worker ou servidor. */
export function formFingerprint(form) {
  return JSON.stringify(
    [...form.querySelectorAll("input,select,textarea")]
      .filter((field) => !["submit", "reset", "button"].includes(field.type))
      .map((field) => ({
        name: field.name || field.id,
        value:
          field.type === "file"
            ? [...(field.files || [])].map((file) => [
                file.name,
                file.size,
                file.lastModified,
              ])
            : ["checkbox", "radio"].includes(field.type)
              ? Boolean(field.checked)
              : (field.value ?? ""),
      })),
  );
}
export function updateSafety({
  writing = false,
  preferencesWriting = false,
  session = false,
  collecting = false,
  hardwareBusy = false,
  unsavedSession = false,
  dirtyForms = false,
} = {}) {
  const reasons = [];
  if (writing || preferencesWriting) reasons.push("Salvamento em andamento.");
  if (session || collecting || hardwareBusy)
    reasons.push("Uma conexão ou consulta real está em andamento.");
  if (unsavedSession)
    reasons.push("Há dados de uma sessão real ainda não salvos.");
  if (dirtyForms)
    reasons.push("Há um formulário ou arquivo selecionado ainda não salvo.");
  return { safe: reasons.length === 0, reasons };
}
