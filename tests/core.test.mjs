import test from "node:test";
import assert from "node:assert/strict";
import { makeDemo } from "./fixtures/demo.mjs";
import {
  ANALYSIS_DEFAULTS,
  SIMULATION_DEFAULTS,
  ValidationError,
  analyze,
  csvEncode,
  decodeFile,
  parseDiagnostics,
  parseSignals,
  simulate,
  validateSamples,
} from "../dist/core.mjs";

const HEADER = "tempo_s;pedal_pct;throttle_pct;rpm\n";
const stepSamples = () => Array.from({ length: 51 }, (_, i) => ({
  time_s: i / 10,
  pedal_pct: i >= 10 ? 50 : 0,
  throttle_pct: i >= 14 ? 40 : 5,
  rpm: i >= 18 ? 2000 : 850,
}));
const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);
const codes = (result) => result.findings.map((finding) => finding.code);

test("CSV brasileiro com BOM, aliases e vírgula decimal", () => {
  const text = "\ufeffTempo (s);Posição do pedal (%);Abertura da borboleta (%);Rotação do motor (RPM)\r\n0,00;0;5;850\r\n0,10;30;7,5;950\r\n";
  const result = parseSignals(text);
  assert.equal(result.delimiter, ";");
  assert.equal(result.samples[1].time_s, 0.1);
  assert.equal(result.samples[1].throttle_pct, 7.5);
  assert.equal(result.mapping.pedal_pct, "Posição do pedal (%)");
});

for (const delimiter of [";", ",", "\t"]) {
  test(`CSV com separador ${JSON.stringify(delimiter)}`, () => {
    const text = (HEADER + "0;0;5;850\n0.1;30;7;950\n").replaceAll(";", delimiter);
    assert.equal(parseSignals(text).samples[1].rpm, 950);
  });
}

test("UTF-8 e Windows-1252 são decodificados sem rede", () => {
  const text = "Posição;Rotação\n1;2";
  assert.equal(decodeFile(new TextEncoder().encode(text)), text);
  assert.equal(decodeFile(Uint8Array.from(Buffer.from(text, "latin1"))), text);
  assert.equal(decodeFile(new TextEncoder().encode("\ufeff" + text).buffer), text);
  assert.throws(() => decodeFile(new Uint8Array()), ValidationError);
  assert.throws(() => decodeFile(new Uint8Array([0, 65])), /Codificação/);
  assert.throws(() => decodeFile(new Uint8Array(5 * 1024 * 1024 + 1)), /5 MB/);
});

test("Milissegundos são reconhecidos pelo cabeçalho", () => {
  const result = parseSignals("tempo_ms;pedal_pct;throttle_pct;rpm\n0;0;5;850\n50;30;8;950");
  assert.equal(result.samples[1].time_s, 0.05);
});

test("Mapeamento explícito e sobrescrita da unidade", () => {
  const result = parseSignals("T;APP;TPS;N\n0;0;5;850\n50;30;8;950", {time_s:"T", pedal_pct:"APP", throttle_pct:"TPS", rpm:"N"}, "ms");
  assert.equal(result.samples[1].time_s, 0.05);
  assert.equal(result.mapping.rpm, "N");
});

test("Horário HH:MM:SS com fração decimal", () => {
  const result = parseSignals(HEADER + "12:01:00,00;0;5;850\n12:01:00,20;30;8;950");
  close(result.samples[1].time_s - result.samples[0].time_s, 0.2);
});

for (const [label, body] of [
  ["tempo duplicado", "0;0;5;850\n0;30;8;950"],
  ["tempo fora de ordem", "1;0;5;850\n0;30;8;950"],
  ["tempo negativo", "-1;0;5;850\n0;30;8;950"],
  ["pedal maior que 100", "0;0;5;850\n1;101;8;950"],
  ["borboleta negativa", "0;0;5;850\n1;30;-1;950"],
  ["rotação fora do limite", "0;0;5;850\n1;30;8;15001"],
  ["NaN", "0;0;5;850\n1;NaN;8;950"],
  ["infinito", "0;0;5;850\n1;30;Infinity;950"],
  ["célula vazia", "0;0;5;850\n1;;8;950"],
  ["unidade dentro da célula", "0;0;5;850\n1;30%;8;950"],
  ["número hexadecimal", "0;0;5;850\n1;0x20;8;950"],
  ["uma amostra", "0;0;5;850"],
  ["campo a mais", "0;0;5;850\n1;30;8;950;extra"],
  ["campo a menos", "0;0;5;850\n1;30;8"],
  ["horário inválido", "00:61:00;0;5;850\n00:62:00;30;8;950"],
]) {
  test(`Rejeita ${label} sem descartar linhas`, () => assert.throws(() => parseSignals(HEADER + body), ValidationError));
}

for (const [label, content] of [
  ["vazio", ""],
  ["sem dados", HEADER],
  ["colunas duplicadas", "tempo_s;tempo_s;pedal_pct;throttle_pct;rpm\n0;0;0;5;850\n1;1;30;8;950"],
  ["aspas abertas", HEADER + '0;0;5;850\n1;"30;8;950'],
  ["caractere após aspas", HEADER + '0;0;5;850\n1;"30"X;8;950'],
  ["caractere nulo", HEADER + "0;0;5;850\n1;30;8;95\x000"],
]) {
  test(`Rejeita arquivo ${label}`, () => assert.throws(() => parseSignals(content), ValidationError));
}

test("Cabeçalho ambíguo exige mapeamento manual", () => {
  const content = "tempo_s;pedal_pct;pedal;throttle_pct;rpm\n0;0;0;5;850\n1;30;30;8;950";
  assert.throws(() => parseSignals(content), /Mapeie/);
  assert.equal(parseSignals(content, {pedal_pct:"pedal"}).samples.length, 2);
});

test("Mapeamento exige quatro colunas distintas e existentes", () => {
  const content = HEADER + "0;0;5;850\n1;30;8;950";
  assert.throws(() => parseSignals(content, {pedal_pct:"rpm"}), /diferentes/);
  assert.throws(() => parseSignals(content, {pedal_pct:"inexistente"}), /não encontrada/);
  assert.throws(() => parseSignals(content, {}, "min"), /Unidade/);
});

test("CSV DTC preserva texto, aspas, delimitadores e quebras de linha", () => {
  const result = parseDiagnostics('codigo;descricao;status\r\np0121;"Exemplo; com ""aspas""\nna descrição";Histórico\r\n');
  assert.deepEqual(result, [{code:"P0121", description:'Exemplo; com "aspas"\nna descrição', status:"Histórico"}]);
});

for (const content of [
  "codigo;descricao;status\nINVALIDO;Descrição;Histórico",
  "codigo;descricao;status\nP0121;;Histórico",
  "codigo;status\nP0121;Histórico",
]) test("Relatório DTC inválido é rejeitado", () => assert.throws(() => parseDiagnostics(content), ValidationError));

test("Atrasos conhecidos de degraus independentes", () => {
  const result = analyze(stepSamples());
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].time_s, 1);
  assert.equal(result.median_throttle_delay_s, 0.4);
  assert.equal(result.median_rpm_delay_s, 0.8);
  close(result.interval_s, 0.1);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.config, ANALYSIS_DEFAULTS);
});

test("Ausência de acionamento não vira atraso zero", () => {
  const samples = Array.from({length:30}, (_,i) => ({time_s:i/10,pedal_pct:0,throttle_pct:5,rpm:850}));
  const result = analyze(samples);
  assert.equal(result.events.length, 0);
  assert.equal(result.median_throttle_delay_s, null);
  assert.ok(codes(result).includes("SEM_EVENTOS"));
});

for (const [scenario, expectedCode] of [["lenta","RESPOSTA_LENTA"], ["sem_resposta","RESPOSTA_AUSENTE"]]) {
  test(`Cenário fictício ${scenario} produz a observação esperada`, () => {
    const samples = makeDemo(scenario), result = analyze(samples);
    assert.equal(samples.length, 701);
    assert.equal(samples.at(-1).time_s, 35);
    assert.equal(result.events.length, 3);
    assert.ok(codes(result).includes(expectedCode));
  });
}

test("Cenário de referência sem hipótese de demora", () => {
  const result = analyze(makeDemo("normal"));
  assert.equal(result.events.length, 3);
  assert.ok(result.median_throttle_delay_s < 0.5);
  assert.deepEqual(result.findings, []);
  assert.throws(() => makeDemo("desconhecido"), /Cenário/);
});

test("Limiar ajustado muda a hipótese, mantendo a medição", () => {
  const result = analyze(stepSamples(), [], {slow_threshold_s:0.2});
  assert.equal(result.median_throttle_delay_s, 0.4);
  assert.ok(codes(result).includes("RESPOSTA_LENTA"));
});

test("Lacuna na aquisição exclui o evento da medição", () => {
  const samples = stepSamples().filter((sample) => !(sample.time_s >= 1.1 && sample.time_s < 2.2));
  const result = analyze(samples);
  assert.equal(result.events[0].usable, false);
  assert.equal(result.median_throttle_delay_s, null);
  assert.ok(codes(result).includes("AMOSTRAGEM_IRREGULAR"));
  assert.ok(!codes(result).includes("RESPOSTA_AUSENTE"));
});

test("Soltar pedal encerra a janela antes de outra resposta", () => {
  const samples = Array.from({length:40}, (_,i) => ({time_s:i/10,pedal_pct:i>=10&&i<12?50:0,throttle_pct:i>=15?40:5,rpm:850}));
  const result = analyze(samples);
  assert.equal(result.events[0].end_s, 1.2);
  assert.equal(result.events[0].throttle_delay_s, null);
});

test("Rampa contínua conta como um evento", () => {
  const samples = Array.from({length:40}, (_,i) => ({time_s:i/10,pedal_pct:Math.min(60,Math.max(0,(i-10)*5)),throttle_pct:5,rpm:850}));
  assert.equal(analyze(samples).events.length, 1);
});

test("Motor parado e DTC importado são observações contextualizadas", () => {
  const result = analyze([{time_s:0,pedal_pct:0,throttle_pct:5,rpm:0},{time_s:1,pedal_pct:0,throttle_pct:5,rpm:0}], [{code:"P0121",description:"Fictício",status:"Histórico"}]);
  assert.ok(["P0121","MOTOR_PARADO","BAIXA_RESOLUCAO"].every((code) => codes(result).includes(code)));
});

for (const config of [{pedal_rise_pp:0},{response_window_s:NaN},{throttle_rise_pp:101},{rpm_rise:"100"}]) {
  test("Análise rejeita configuração inválida", () => assert.throws(() => analyze(stepSamples(), [], config), ValidationError));
}

test("50.000 amostras densas são analisadas sem busca quadrática", {timeout:5000}, () => {
  const samples = Array.from({length:50000}, (_,i) => ({time_s:i/100000,pedal_pct:i%2?50:0,throttle_pct:5,rpm:850}));
  const result = analyze(samples);
  assert.equal(result.sample_count, 50000);
  assert.equal(result.events.length, 25000);
  assert.equal(result.median_throttle_delay_s, null);
});

test("Simulação coincide com a solução analítica, atraso entre amostras", () => {
  const samples = Array.from({length:31}, (_,i) => ({time_s:i/10,pedal_pct:i>=10?100:0,throttle_pct:0,rpm:850}));
  const result = simulate(samples, {delay_s:0.25,tau_s:0.5,maximum_pct:100});
  assert.equal(result[12].simulated_throttle_pct, 0);
  close(result[13].simulated_throttle_pct, 100*(1-Math.exp(-0.05/0.5)), 1e-5);
  close(result[20].simulated_throttle_pct, 100*(1-Math.exp(-0.75/0.5)), 1e-5);
});

test("Atraso zero não antecipa o degrau", () => {
  const samples = Array.from({length:30}, (_,i) => ({time_s:i/10,pedal_pct:i>=10?100:0,throttle_pct:0,rpm:850}));
  const result = simulate(samples, {delay_s:0,tau_s:0.5,maximum_pct:100});
  assert.equal(result[10].simulated_throttle_pct, 0);
  assert.ok(result[11].simulated_throttle_pct > 0);
});

test("Perfis distintos deixam as amostras originais intactas", () => {
  const samples = stepSamples(), before = structuredClone(samples);
  const slow = simulate(samples, {delay_s:0.5,tau_s:0.7,gamma:1.6});
  const fast = simulate(samples, {delay_s:0.05,tau_s:0.1,gamma:0.7});
  assert.ok(fast[15].simulated_throttle_pct > slow[15].simulated_throttle_pct);
  assert.deepEqual(samples, before);
  assert.ok([...slow,...fast].every((sample) => sample.simulated_throttle_pct >= 0 && sample.simulated_throttle_pct <= 100));
  assert.equal(simulate(samples).length, samples.length);
  assert.equal(SIMULATION_DEFAULTS.delay_s, 0.15);
});

for (const config of [{delay_s:-1},{tau_s:0},{gamma:0},{maximum_pct:101},{delay_s:Infinity}]) {
  test("Simulação rejeita parâmetros fora do modelo", () => assert.throws(() => simulate(stepSamples(), config), ValidationError));
}

test("CSV de saída protege fórmulas sem alterar números", () => {
  const content = csvEncode(["texto","valor"], [["=1+1",-2],["  @DADO",3],['aspas; "teste"',4]]);
  assert.ok(content.startsWith("\ufeff"));
  assert.ok(content.includes("'=1+1;-2"));
  assert.ok(content.includes("'  @DADO;3"));
  assert.ok(content.includes('"aspas; ""teste""";4'));
});

test("CSV exportado pode ser importado sem perder as amostras", () => {
  const samples = makeDemo("normal");
  const content = csvEncode(["time_s","pedal_pct","throttle_pct","rpm"], samples.map((sample) => [sample.time_s,sample.pedal_pct,sample.throttle_pct,sample.rpm]));
  assert.deepEqual(parseSignals(content).samples, samples);
});

test("Validação protege também chamadas sem CSV", () => {
  assert.throws(() => validateSamples([{time_s:0,pedal_pct:0,throttle_pct:5,rpm:850}]), ValidationError);
  assert.throws(() => validateSamples([{time_s:0,pedal_pct:"0",throttle_pct:5,rpm:850},{time_s:1,pedal_pct:30,throttle_pct:5,rpm:850}]), ValidationError);
});
