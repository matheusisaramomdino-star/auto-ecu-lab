import test from "node:test";
import assert from "node:assert/strict";
import {BleTransport,WebSerialTransport,getCapabilities} from "../dist/transports.mjs";

class Events {
  constructor(){this.listeners=new Map();}
  addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);}
  removeEventListener(type,handler){this.listeners.get(type)?.delete(handler);}
  dispatch(type,event={}){for(const handler of this.listeners.get(type)||[])handler({target:this,...event});}
  listenerCount(){return [...this.listeners.values()].reduce((n,entries)=>n+entries.size,0);}
}
function bleFake({notifyError=false,autoReply=null,writeError=false}={}) {
  const device=new Events();device.name="Adaptador documentado";
  const receiver=new Events();receiver.properties={notify:true};receiver.stops=0;
  receiver.startNotifications=async()=>{if(notifyError)throw new Error("Falha notificações");return receiver;};receiver.stopNotifications=async()=>{receiver.stops++;};
  receiver.notify=text=>{const bytes=new TextEncoder().encode(text);receiver.value=new DataView(bytes.buffer);receiver.dispatch("characteristicvaluechanged");};
  const commands=[];
  const sender={properties:{write:true},async writeValueWithResponse(bytes){if(writeError)throw new Error("Envio recusado");const command=new TextDecoder().decode(bytes);commands.push(command);if(autoReply)queueMicrotask(()=>receiver.notify(autoReply(command)));}};
  const validateUuid=uuid=>{assert.match(uuid,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);return uuid;};
  const requestedUuids=[];
  const server={getPrimaryService:async uuid=>{requestedUuids.push(validateUuid(uuid));return{getCharacteristic:async uuid=>{requestedUuids.push(validateUuid(uuid));return uuid==="0000fff1-0000-1000-8000-00805f9b34fb"?sender:receiver;}};}};
  device.gatt={connected:false,async connect(){this.connected=true;return server;},disconnect(){this.connected=false;device.dispatch("gattserverdisconnected");}};
  let selections=0,selectionOptions;
  const navigator={bluetooth:{async requestDevice(options){options.optionalServices.forEach(validateUuid);selections++;selectionOptions=options;return device;}}};
  const connect=(options={})=>BleTransport.connect({serviceUuid:"fff0",writeUuid:"fff1",notifyUuid:"fff2",navigator,...options});
  return {device,receiver,sender,commands,navigator,connect,requestedUuids,selections:()=>selections,selectionOptions:()=>selectionOptions};
}
function serialFake() {
  const serial=new Events(),commands=[],queue=[];let waiter;let done=false;
  const reader={released:0,async read(){if(queue.length)return queue.shift();if(done)return{done:true};return new Promise(resolve=>waiter=resolve);},async cancel(){done=true;waiter?.({done:true});waiter=null;},releaseLock(){this.released++;}};
  const writer={released:0,async write(bytes){commands.push(new TextDecoder().decode(bytes));},releaseLock(){this.released++;}};
  const port={opened:[],closed:0,readable:{getReader:()=>reader},writable:{getWriter:()=>writer},async open(options){this.opened.push(options);},async close(){this.closed++;}};
  let selections=0;serial.requestPort=async()=>{selections++;return port;};
  const receive=text=>{const data={done:false,value:new TextEncoder().encode(text)};if(waiter){const resolve=waiter;waiter=null;resolve(data);}else queue.push(data);};
  return {serial,port,reader,writer,commands,receive,selections:()=>selections,connect:(options={})=>WebSerialTransport.connect({navigator:{serial},...options})};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test("capacidade depende da API real, sem bloquear Serial no Android",()=>{
  const cap=getCapabilities({navigator:{userAgent:"Android",serial:{requestPort(){}},bluetooth:{requestDevice(){}},usb:{requestDevice(){}}}});
  assert.equal(cap.platform,"android");assert.equal(cap.serial,true);assert.equal(cap.classicViaSerial,true);assert.equal(cap.ble,true);assert.equal(cap.usb,true);assert.equal(cap.wifi,false);
  const ios=getCapabilities({navigator:{userAgent:"iPhone"}});assert.equal(ios.platform,"ios");assert.equal(ios.ble,false);assert.equal(ios.serial,false);
});
test("navegador sem APIs apresenta instrução e não inventa conexão",async()=>{
  await assert.rejects(WebSerialTransport.connect({navigator:{}}),/Web Serial indisponível/);
  await assert.rejects(BleTransport.connect({navigator:{}}),/Web Bluetooth indisponível/);
});
test("BLE exige UUIDs documentados antes de abrir seletor",async()=>{
  const fake=bleFake();assert.equal(fake.selections(),0);
  await assert.rejects(fake.connect({serviceUuid:"inventado"}),/UUID documentado/);assert.equal(fake.selections(),0);
  const transport=await fake.connect();assert.equal(fake.selections(),1);assert.deepEqual(fake.selectionOptions(),{acceptAllDevices:true,optionalServices:["0000fff0-0000-1000-8000-00805f9b34fb"]});assert.deepEqual(fake.requestedUuids,["0000fff0-0000-1000-8000-00805f9b34fb","0000fff1-0000-1000-8000-00805f9b34fb","0000fff2-0000-1000-8000-00805f9b34fb"]);await transport.close();
});
test("BLE agrega fragmentos até prompt e escreve apenas após request explícito",async()=>{
  const fake=bleFake(),transport=await fake.connect();assert.deepEqual(fake.commands,[]);
  const pending=transport.request("010C");await tick();assert.deepEqual(fake.commands,["010C\r"]);
  fake.receiver.notify("7E8 04 41 ");fake.receiver.notify("0C 1A F8\r");fake.receiver.notify(">");
  assert.equal(await pending,"7E8 04 41 0C 1A F8\r>");await transport.close();
});
test("BLE serializa consultas e não associa resposta ao próximo comando",async()=>{
  const fake=bleFake(),transport=await fake.connect();
  const first=transport.request("010C"),second=transport.request("0111");await tick();assert.deepEqual(fake.commands,["010C\r"]);
  fake.receiver.notify("7E8 04 41 0C 1A F8\r>");await first;await tick();assert.deepEqual(fake.commands,["010C\r","0111\r"]);
  fake.receiver.notify("7E8 03 41 11 80\r>");await second;await transport.close();
});
test("serviços destrutivos e comandos concatenados são bloqueados antes do envio",async()=>{
  const fake=bleFake(),transport=await fake.connect();
  assert.throws(()=>transport.request("04"),/bloqueado/);assert.throws(()=>transport.request("010C\r04"),/inválido/);assert.deepEqual(fake.commands,[]);await transport.close();
});
test("timeout encerra conexão e consultas enfileiradas não enviam comandos atrasados",async()=>{
  const fake=bleFake(),transport=await fake.connect({timeoutMs:100});
  const first=transport.request("010C"),second=transport.request("0111");
  const outcomes=await Promise.allSettled([first,second]);assert.equal(outcomes[0].reason.code,"TIMEOUT");assert.equal(outcomes[1].reason.code,"DISCONNECTED");
  await transport.close();assert.equal(transport.isConnected,false);assert.deepEqual(fake.commands,["010C\r"]);assert.equal(fake.device.listenerCount(),0);assert.equal(fake.receiver.listenerCount(),0);
});
test("desconexão BLE rejeita consulta pendente e remove listeners",async()=>{
  const fake=bleFake(),transport=await fake.connect();const pending=transport.request("010C");await tick();fake.device.gatt.disconnect();
  await assert.rejects(pending,/desconectado/);await transport.close();assert.equal(transport.isConnected,false);assert.equal(fake.device.listenerCount(),0);assert.equal(fake.receiver.listenerCount(),0);
});
test("falha na notificação BLE limpa recursos já registrados",async()=>{
  const fake=bleFake({notifyError:true});await assert.rejects(fake.connect(),/Falha notificações/);
  assert.equal(fake.device.gatt.connected,false);assert.equal(fake.receiver.listenerCount(),0);assert.equal(fake.device.listenerCount(),0);
});
test("falha de envio BLE fecha a sessão sem consumir respostas futuras",async()=>{
  const fake=bleFake({writeError:true}),transport=await fake.connect();await assert.rejects(transport.request("010C"),/Falha ao enviar/);await transport.close();assert.equal(transport.isConnected,false);
});
test("serial abre porta escolhida, reagrupa chunks e libera os locks",async()=>{
  const fake=serialFake(),transport=await fake.connect({baudRate:115200});assert.equal(fake.selections(),1);assert.equal(fake.port.opened[0].baudRate,115200);assert.deepEqual(fake.commands,[]);
  const pending=transport.request("010C");await tick();fake.receive("7E8 04 41 0C");fake.receive(" 1A F8\r>");assert.equal(await pending,"7E8 04 41 0C 1A F8\r>");
  await transport.close();assert.equal(fake.port.closed,1);assert.equal(fake.reader.released,1);assert.equal(fake.writer.released,1);assert.equal(fake.serial.listenerCount(),0);
});
test("desconexão serial rejeita pendência e conserva consultas não enviadas",async()=>{
  const fake=serialFake(),transport=await fake.connect();const pending=transport.request("010C");await tick();fake.serial.dispatch("disconnect",{port:fake.port});
  await assert.rejects(pending,/desconectado/);await transport.close();assert.equal(transport.isConnected,false);assert.equal(fake.serial.listenerCount(),0);
});
test("velocidade serial inválida não abre o seletor",async()=>{
  const fake=serialFake();await assert.rejects(fake.connect({baudRate:NaN}),/Velocidade/);assert.equal(fake.selections(),0);
});
