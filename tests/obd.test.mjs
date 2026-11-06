import test from "node:test";
import assert from "node:assert/strict";
import {ElmSession,ObdError,assertReadOnlyCommand,parseCanResponses,parseElmResponse,decodeDtc} from "../dist/obd.mjs";

const hex=n=>n.toString(16).toUpperCase().padStart(2,"0");
function can(payload,id="7E8") {
  const frames=[];
  if(payload.length<=7)frames.push([payload.length,...payload]);
  else {
    frames.push([0x10|(payload.length>>8),payload.length&255,...payload.slice(0,6)]);
    for(let i=6,sequence=1;i<payload.length;i+=7,sequence=(sequence+1)&15)frames.push([0x20|sequence,...payload.slice(i,i+7)]);
  }
  return frames.map(bytes=>id+" "+bytes.map(hex).join(" ")).join("\r")+"\r>";
}
const ascii=text=>[...text].map(char=>char.charCodeAt(0));
function fixture(overrides={}) {
  const values={ATZ:"ELM327 v2.3\r>",ATI:"ELM327 v2.3\r>",ATDPN:"A6\r>",
    "0100":can([0x41,0,0,0x10,0x80,1]),"0120":can([0x41,0x20,0,0,0,1]),"0140":can([0x41,0x40,0,0x80,0,0]),
    "010C":can([0x41,0x0c,0x1a,0xf8]),"0111":can([0x41,0x11,0x80]),"0149":can([0x41,0x49,0x40]),
    "0900":can([0x49,0,0x54,0,0,0]),"0902":can([0x49,2,1,...ascii("1D4GP00R55B123456")]),
    "0904":can([0x49,4,1,...ascii("1234567890ABCDEF")]),"0906":can([0x49,6,1,0x12,0x34,0x56,0x78]),
    "03":can([0x43,2,1,0x33,0xc1,0x23]),"07":can([0x47,0]),"0A":can([0x4a,1,2,0x10]),...overrides};
  const commands=[];
  const transport={commands,isConnected:true,async request(command){commands.push(command);return values[command]??"OK\r>";},async close(){this.isConnected=false;}};
  return {values,transport,session:new ElmSession(transport)};
}

test("consultas são allowlist e operações destrutivas/console arbitrário são bloqueados",()=>{
  for(const command of ["04","08","2E1234FF","ATSH123","ATMA","010C\r04","","ATPPFFON",null])assert.throws(()=>assertReadOnlyCommand(command),ObdError);
  assert.equal(assertReadOnlyCommand("01 0c"),"010C");
  assert.equal(assertReadOnlyCommand("AT CAF1"),"ATCAF1");
});
test("CAN com cabeçalho tem origem preservada e bytes PCI removidos",()=>{
  const result=parseElmResponse("010C\rSEARCHING...\r7E8 04 41 0C 1A F8 00 00 00\r>",{request:"010C"});
  assert.equal(result.ecuId,"7E8");assert.deepEqual(result.payload,[0x41,0x0c,0x1a,0xf8]);
});
test("duas ECUs não misturam payloads nem VINs em ISO-TP intercalado",()=>{
  const first=can([0x49,2,1,...ascii("1D4GP00R55B123456")],"7E8").replace(/\r>$/,"").split("\r");
  const second=can([0x49,2,1,...ascii("1FAHP3K2XCL123456")],"7E9").replace(/\r>$/,"").split("\r");
  const raw=first.flatMap((line,i)=>[line,second[i]]).join("\r")+"\r>";
  assert.throws(()=>parseElmResponse(raw,{request:"0902"}),error=>error.code==="AMBIGUOUS_ECU"&&error.details.responders.join(",")==="7E8,7E9");
  const result=parseElmResponse(raw,{request:"0902",ecuId:"7E8"});
  assert.deepEqual(result.responders,["7E8","7E9"]);
  assert.equal(String.fromCharCode(...result.payload.slice(3)),"1D4GP00R55B123456");
  assert.equal(String.fromCharCode(...parseElmResponse(raw,{request:"0902",ecuId:"7E9"}).payload.slice(3)),"1FAHP3K2XCL123456");
});
test("múltiplas origens sem 7E8 exigem seleção explícita",()=>{
  const raw=can([0x41,0x11,10],"7E9").replace(">","")+can([0x41,0x11,20],"7EA");
  assert.throws(()=>parseElmResponse(raw,{request:"0111"}),error=>error.code==="AMBIGUOUS_ECU"&&error.details.responders.length===2);
  assert.equal(parseElmResponse(raw,{request:"0111",ecuId:"7EA"}).payload[2],20);
  assert.throws(()=>parseElmResponse(raw,{request:"0111",ecuId:"7E8"}),/não respondeu/);
});
for(const [label,raw] of [
  ["sem prompt","7E8 04 41 0C 1A F8"],
  ["sem cabeçalho","41 0C 1A F8\r>"],
  ["CAN 29 bits","18DAF110 04 41 0C 1A F8\r>"],
  ["curto","7E8 04 41 0C 1A\r>"],
  ["bus error","CAN ERROR\r>"],
  ["no data","NO DATA\r>"],
  ["múltiplos prompts","7E8 03 41 11 80\r>extra>"],
  ["quadro desconhecido","7E8 30 00 00\r>"],
  ["frame duplicado","7E8 03 41 11 80\r7E8 03 41 11 80\r>"],
])test(`resposta ${label} não vira leitura válida`,()=>assert.throws(()=>parseElmResponse(raw,{request:"010C"}),ObdError));
test("multiframe incompleto ou fora de sequência é rejeitado",()=>{
  const raw=can([0x49,2,1,...ascii("1D4GP00R55B123456")]);
  assert.throws(()=>parseElmResponse(raw.replace(/7E8 22[^\r]+\r/,""),{request:"0902"}),/incompleta/);
  assert.throws(()=>parseElmResponse(raw.replace("7E8 21","7E8 22"),{request:"0902"}),/Sequência/);
  assert.throws(()=>parseElmResponse("7E8 21 01 02\r>",{request:"0902"}),/Sequência/);
});
test("NRC e resposta a outro PID não são reaproveitados",()=>{
  assert.throws(()=>parseElmResponse(can([0x7f,1,0x12]),{request:"010C"}),error=>error.code==="NEGATIVE_RESPONSE"&&error.details.nrc==="12");
  assert.throws(()=>parseElmResponse(can([0x7f,9,0x12]),{request:"010C"}),error=>error.code==="WRONG_RESPONSE");
  assert.throws(()=>parseElmResponse(can([0x41,0x11,1]),{request:"010C"}),/não corresponde/);
});
test("DTC CAN respeita byte de contagem em vez de deslocar os pares",()=>{
  assert.deepEqual(decodeDtc([0x43,2,1,0x33,0xc1,0x23]),["P0133","U0123"]);
  assert.deepEqual(decodeDtc([0x43,0]),[]);
  assert.throws(()=>decodeDtc([0x43,2,1,0x33]),/Quantidade/);
  assert.throws(()=>decodeDtc([0x43,0,1,0x33]),/Quantidade/);
  assert.throws(()=>decodeDtc([0x43,1,0,0]),/vazio/);
});
test("inicialização valida apresentação, protocolo e máscaras sem mandar comandos de escrita",async()=>{
  const {session,transport}=fixture();
  const result=await session.initialize();assert.equal(result.sourceMode,"real");assert.equal(result.ecuId,"7E8");assert.equal(result.protocol,"A6");
  const supported=await session.supportedPids();assert.deepEqual(supported.supports,{rpm:true,throttle:true,pedal:true});
  assert.ok(transport.commands.every(command=>assertReadOnlyCommand(command)));
  assert.ok(!transport.commands.some(command=>command==="04"));
});
test("inicialização com 7E8 e 7E9 exige seleção e usa somente a máscara selecionada",async()=>{
  const both=can([0x41,0,0,0x10,0x80,0],"7E8").replace(">","")+can([0x41,0,0,0,0,0],"7E9");
  const {transport,session}=fixture({"0100":both});
  await assert.rejects(session.initialize(),error=>error.code==="AMBIGUOUS_ECU"&&error.details.responders.join(",")==="7E8,7E9");
  await assert.rejects(session.readSignals(),error=>error.code==="NOT_INITIALIZED");
  const selected=new ElmSession(transport,{ecuId:"7E9"});
  const info=await selected.initialize();assert.equal(info.ecuId,"7E9");assert.deepEqual(info.responders,["7E8","7E9"]);
  const supported=await selected.supportedPids();assert.deepEqual(supported.supports,{rpm:false,throttle:false,pedal:false});
  const result=await selected.readSignals();assert.equal(result.rpm,null);assert.equal(result.throttle_pct,null);assert.equal(result.pedal_pct,null);
});
test("não confirma conexão usando apenas a identificação do adaptador",async()=>{
  await assert.rejects(fixture({"0100":"UNABLE TO CONNECT\r>"}).session.initialize(),/adaptador informou/);
  await assert.rejects(fixture({ATDPN:"A7\r>"}).session.initialize(),/11 bits/);
  await assert.rejects(fixture({ATH1:"?\r>"}).session.initialize(),/adaptador informou/);
  await assert.rejects(fixture({ATZ:"SDK proprietary\r>"}).session.initialize(),/não se identificou/);
});
test("leituras usam fórmulas OBD-II e horários por canal",async()=>{
  const {transport}=fixture();let time=1000;
  const session=new ElmSession(transport,{clock:()=>time+=20});await session.initialize();
  const result=await session.readSignals();
  assert.equal(result.rpm,1726);assert.equal(result.throttle_pct,128*100/255);assert.equal(result.pedal_pct,64*100/255);
  assert.equal(result.sourceMode,"real");assert.ok(result.channels.rpm.observed_at_s<result.channels.pedal_pct.observed_at_s);
  assert.ok(result.time_s>0);assert.deepEqual(result.errors,[]);
});
test("PID ausente é null e não é consultado nem substituído por zero",async()=>{
  const {session,transport}=fixture({"0140":can([0x41,0x40,0,0,0,0])});await session.initialize();
  const result=await session.readSignals();assert.equal(result.pedal_pct,null);assert.equal(result.channels.pedal_pct.supported,false);assert.ok(!transport.commands.includes("0149"));
});
test("PID truncado ou NO DATA é registrado como leitura inválida",async()=>{
  const {session}=fixture({"010C":"NO DATA\r>","0149":can([0x41,0x49])});await session.initialize();
  const result=await session.readSignals();assert.equal(result.rpm,null);assert.equal(result.pedal_pct,null);assert.equal(result.errors.length,2);assert.notEqual(result.throttle_pct,null);
});
test("identificação fornece VIN/CALID/CVN sem inventar fabricante ou família",async()=>{
  const {session}=fixture();await session.initialize();const result=await session.identify();
  assert.equal(result.vin,"1D4GP00R55B123456");assert.deepEqual(result.calibrationIds,["1234567890ABCDEF"]);assert.deepEqual(result.cvns,["12345678"]);
  assert.equal(result.manufacturer,undefined);assert.deepEqual(result.errors,[]);
});
test("VIN incorreto ou serviço09 ausente mantém identificação desconhecida",async()=>{
  const bad=fixture({"0902":can([0x49,2,1,...ascii("0000000000000000I")])}).session;await bad.initialize();const result=await bad.identify();assert.equal(result.vin,null);assert.equal(result.errors.length,1);
  const missing=fixture({"0900":"NO DATA\r>"}).session;await missing.initialize();const unknown=await missing.identify();assert.equal(unknown.vin,null);assert.deepEqual(unknown.calibrationIds,[]);assert.equal(unknown.errors.length,1);
});
test("DTCs armazenados, pendentes e permanentes têm origem e status preservados",async()=>{
  const {session}=fixture();await session.initialize();const result=await session.readDtc();
  assert.equal(result.complete,true);assert.deepEqual(result.codes.map(c=>[c.code,c.status,c.ecuId]),[["P0133","Armazenado","7E8"],["U0123","Armazenado","7E8"],["P0210","Permanente","7E8"]]);
});
test("NO DATA em um serviço DTC não comprova ausência de DTCs",async()=>{
  const {session}=fixture({"03":"NO DATA\r>","07":"NO DATA\r>","0A":"NO DATA\r>"});await session.initialize();const result=await session.readDtc();
  assert.equal(result.complete,false);assert.equal(result.errors.length,3);assert.deepEqual(result.codes,[]);
});
test("sessão exige inicialização e fecha transporte real sem fallback",async()=>{
  const {session,transport}=fixture();await assert.rejects(session.readSignals(),/Inicialize/);await session.initialize();await session.close();
  assert.equal(transport.isConnected,false);await assert.rejects(session.readSignals(),/desconectada/);
});
