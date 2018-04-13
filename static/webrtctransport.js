
import * as wrtcMod from "./index.js";

let webrtctransport = {
  transports : {
  }
}
let wasm_mod = null;

function load_wasm_mod (cb) {
  fetch("webrtctransport.wasm").then(response =>
    response.arrayBuffer()
  ).then(bytes =>
    WebAssembly.instantiate(bytes, { env: {
      wasm_log : wasm_log,
      //yield_loop : yield_loop,
      query_listener : query_listener,
      next_pending_connected : next_pending_connected,
      query_new_channel : query_new_channel,
      read_channel_reg : read_channel_reg,
      close_channel : close_channel,
      write : write,
      flush_write : flush_write,
      read : read,
      suspend : suspend,
    } })
  ).then(results => {
    console.log("got instance");
    console.log(results);
    console.log(results.instance.exports);
    let mod = results.instance;
    // test function TODO conditional
    webrtctransport.start_inner = mod.exports.start,
    webrtctransport.connect_to = mod.exports.test_connect_to,
    webrtctransport.send_to = mod.exports.test_send_to,
    // end test function
    webrtctransport.memory = mod.exports.memory;
    webrtctransport.alloc = mod.exports.alloc;
    webrtctransport.dealloc = mod.exports.dealloc;
    webrtctransport.restore = mod.exports.restore;
    webrtctransport.start_with_listener = mod.exports.start_with_listener;
    webrtctransport.transport_ready = mod.exports.transport_ready,
    webrtctransport.connect_success = mod.exports.connect_success;
    webrtctransport.connect_fail = mod.exports.connect_fail;
    webrtctransport.connect_close = mod.exports.connect_close;
    webrtctransport.receive_connect = mod.exports.receive_connect;
    webrtctransport.write_success = mod.exports.write_success;
    webrtctransport.write_error = mod.exports.write_error;
    webrtctransport.trigger_read = mod.exports.trigger_read;
    webrtctransport.trigger_write = mod.exports.trigger_write;
    webrtctransport.forget_readiness = mod.exports.forget_readiness;
    webrtctransport.instantiated = true;
    wasm_mod = webrtctransport;
    cb();
  });
}

function run(id) {
  let s = () => {
    let b = base64ToWasmByte(id);
    wasm_mod.start_inner(b.ptr,b.len);
  };
  if (webrtctransport.instantiated != true) {
    load_wasm_mod(() => s());
  } else {
    s();
  }
}

function testConnect(send_channel, dest) {
   let b = base64ToWasmByte(dest);
   wasm_mod.connect_to(
     send_channel,
     b.ptr,
     b.len
   );
   wasm_mod.restore(webrtctransport.transports[send_channel].handle);
}
function testSend(send_channel, dest, somestring) {
  let d = base64ToWasmByte(dest);
  let b = new TextEncoder().encode(somestring);
  let len = b.length;
  let data_buf = wasm_mod.alloc(len);
  new Uint8Array(wasm_mod.memory.buffer,data_buf,len).set(new Uint8Array(b));
 
   wasm_mod.send_to(
     send_channel,
     d.ptr,
     d.len,
     data_buf,
     len);
   wasm_mod.restore(webrtctransport.transports[send_channel].handle);
}

function wasm_log(msg,err) {
  let strMsg = "Webassembly : " + copyCStr(wasm_mod, msg);
  switch (err) {
    case 1 :
      console.error(strMsg);
      break;
    case 2 :
      alert(strMsg);
      break;
    default :
      console.log(strMsg);
  }
}
/*function yield_loop(transport_handle) {
  // TODO useless line??
  webrtctransport.transports[transport_handle]['unyield'] = transport_handle;
  console.log("yield call");
}*/
const TRANSPORT_STATE = {
  CONNECTING_WS : 1,
  CONNECTED_WS : 2,
}
const CHANNEL_STATE = {
  CONNECTING : 1,
  CONNECTED : 2,
}


function query_listener(send_channel,transport_trigger,transport_handle,transport_status,idListener,idLen) {
  let idB = wasmByteToBase64(idListener,idLen);
  // wrtcmod is curently for a single use so a new instance is used
  let wrtc = new wrtcMod.default();
  let newConnections = [];
  webrtctransport.transports[send_channel] = {
    idListener: idB.b64,
    channel: send_channel,
    handle: transport_handle,
    newConnections: newConnections,
    wrtc: wrtc,
    triggerWasm: transport_trigger,
    stateWasm: transport_status 
  };

  wrtc.ondatachannelopencb = (transport,dataChannel) => {
//    let fromId = base64ToWasmByte(transport.destId);
//    webrtctransport.receive_connect(fromId.ptr,fromId.len,send_channel,dataChannel.id);
    newConnections.push([transport.destId,dataChannel.id]);
    let nc = newConnections[0];
    newConnections[0] = newConnections[newConnections.length - 1];
    newConnections[newConnections.length - 1] = nc;
    webrtctransport.receive_connect(transport_trigger);
    webrtctransport.restore(transport_handle);
  };

  // TODO we put to base64 then internaly change to byte for wsocket
  wrtc.registerUser(idB.b64, () => {
    // on register success
    webrtctransport.transports[send_channel].state = TRANSPORT_STATE.CONNECTED_WS;
    webrtctransport.transport_ready(transport_trigger,transport_status);
    webrtctransport.restore(transport_handle);
  });
}

function next_pending_connected(send_channel, id_out, id_len_out, chan_out) {
   let tr = webrtctransport.transports[send_channel];
   if (tr == null) {
     return false;
   }
   let conn = tr.newConnections.pop();
   if (conn != null) {
     let fromId = base64ToWasmByte(conn[0]);
     
     var bytes = new Uint32Array(wasm_mod.memory.buffer,id_out, 1);
     bytes[0] = fromId.ptr;
     bytes = new Uint32Array(wasm_mod.memory.buffer,id_len_out, 1);
     bytes[0] = fromId.len;
     bytes = new Uint16Array(wasm_mod.memory.buffer,chan_out, 1);
     bytes[0] = conn[1];

     return true;
   } else {
     return false;
   }

  console.error("unimplemented TODO return chanId");
}
function query_new_channel(transport_id_in, dest_id_in, id_len_in, channelr_trigger_in, channelw_trigger_in, channel_status_out, channel_count_out) {
  let idDest = wasmByteToBase64(dest_id_in,id_len_in);
  /*if (channelr_trigger_in == 0) {
    channelr_trigger_in = null;
  }
  // TODO useless!! not stored -> in closure
  let channel = {
    dest: idDest.b64,
    // TODO useless store??
    countWasm: channel_status_out,
    triggerWasmW: channelw_trigger_in,
    triggerWasmR: channelr_trigger_in,
    stateWasm: channel_status_out,
  };*/
  webrtctransport.transports[transport_id_in].wrtc.connectWith(idDest.b64,
          (transport,sendChannel) => { // on open
            webrtctransport.connect_success(channelw_trigger_in, channel_status_out, channel_count_out, sendChannel.id);
            wasm_mod.restore(webrtctransport.transports[transport_id_in].handle);
          },
          (transport,sendChannel) => { // on close
            webrtctransport.connect_close(channelw_trigger_in, channel_status_out);
            if (channelr_trigger_in != 0) {
              webrtctransport.connect_close(channelr_trigger_in, channel_status_out);
            }
            wasm_mod.restore(webrtctransport.transports[transport_id_in].handle);
          },
          (event,sendChannel) => { // on message
  console.error("unimplemented");
          });
}

function read_channel_reg(send_channel, dest_id_in, id_len_in, chanId, chan_trig_r, chan_trig_w, chan_state) {
 
  let idDest = wasmByteToBase64(dest_id_in,id_len_in);
  let chan = webrtctransport.transports[send_channel].wrtc.rtcPeerConnections[idDest.b64].channels[chanId];
  chan.triggerWasmW = chan_trig_w;
  chan.triggerWasmR = chan_trig_r;
  let ooclose = chan.onclose;
  chan.onclose = () => {
    ooclose();
    webrtctransport.connect_close(chan_trigr, chan_state);
    if (chan_trig_w != 0) {
      webrtctransport.connect_close(chan_trigw, chan_state);
    }
    wasm_mod.restore(webrtctransport.transports[send_channel].handle);
  };
  // TODO similar to onmessage with trigerring!!      
//  sendChannel.onmessage = (event) => onChannelMessage(event,sendChannel,cbmessage);
}

function close_channel(chan) {
  console.error("unimplemented");
        // something like
        // webrtctransport.transports[196784].wrtc.rtcPeerConnections["YWlh"].channels[0].close()
}

function write(send_channel, dest_id, id_len, channel_id, content_ptr, content_len) {
  let idDest = wasmByteToBase64(dest_id,id_len);
  let content = fromWasmByte(content_ptr,content_len);
  let tr = webrtctransport.transports[send_channel];
  if (tr == null) {
    return 2;
  }
  let pcs = tr.wrtc.rtcPeerConnections[idDest.b64];
  if (pcs == null) {
    return 2;
  }
  let chan = pcs.channels[channel_id];
  if (chan == null) {
    return 2;
  }
  try {
    chan.send(content.buf);
    return 0;
  } catch (e) {
    console.error(e);
    if (e instanceof InvalidStateError) {
      return 2;
    }
    if (e instanceof NetworkError) {
      return 3;
    }
    if (e instanceof TypeError) {
      return 4;
    }
    return 5;
  }
}

function flush_write(chan) {
  console.error("unimplemented");
}
function read(chan,buf,bufLen) {
  console.error("unimplemented return nb read");
}
function suspend(service) {
  console.error("unimplemented");
}

function base64ToWasmByte(base64) {
  let binary_string =  atob(base64);
  let len = binary_string.length;
  let id_buf = wasm_mod.alloc(len);
 
  let bytes = new Uint8Array(wasm_mod.memory.buffer,id_buf, len);
  for (var i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return {
    buf: bytes,
    ptr: id_buf,
    len: len
  };
}
function fromWasmByte(ptr,len) {
  //let buffer = new Uint8Array(len);
  //buffer.set(new Uint8Array(wasm_mod.memory.buffer, ptr, len));
  let bytes = new Uint8Array(wasm_mod.memory.buffer,ptr, len);
  return {
    buf: bytes,
    ptr: ptr,
    len: len
  };
}

function wasmByteToBase64(ptr,len) {
  let result = fromWasmByte(ptr,len);
  result.b64 = btoa(new TextDecoder().decode(result.buf));
  return result;
}

// copied from sample, is generator efficient ? (does not currently matter for use case)
function copyCStr(module, ptr) {
  let orig_ptr = ptr;
  const collectCString = function* () {
    let memory = new Uint8Array(module.memory.buffer);
    while (memory[ptr] !== 0) {
      if (memory[ptr] === undefined) { throw new Error("Tried to read undef mem") }
      yield memory[ptr]
      ptr += 1
    }
  }

  const buffer_as_u8 = new Uint8Array(collectCString())
  const utf8Decoder = new TextDecoder("UTF-8");
  const buffer_as_utf8 = utf8Decoder.decode(buffer_as_u8);
  module.dealloc(orig_ptr);
  return buffer_as_utf8
}


webrtctransport.run = run;
webrtctransport.testConnect = testConnect;
webrtctransport.testSend = testSend;

export default webrtctransport;
