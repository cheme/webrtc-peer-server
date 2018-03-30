let webrtctransport = {
}
let wasm_mod = null;

function load_wasm_mod (cb) {
  fetch("webrtctransport.wasm").then(response =>
    response.arrayBuffer()
  ).then(bytes =>
    WebAssembly.instantiate(bytes, { env: {
      wasm_log : wasm_log,
      yield_loop : yield_loop,
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
    webrtctransport.memory = mod.exports.memory;
    webrtctransport.start_inner = mod.exports.start,
    webrtctransport.alloc = mod.exports.alloc;
    webrtctransport.dealloc = mod.exports.dealloc;
    webrtctransport.restore = mod.exports.restore;
    webrtctransport.start_with_listener = mod.exports.start_with_listener;
    webrtctransport.connect_success = mod.exports.connect_success;
    webrtctransport.connect_fail = mod.exports.connect_fail;
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
    wasm_mod.start_inner(b,b.length);
  };
  if (webrtctransport.instantiated != true) {
    load_wasm_mod(() => s());
  } else {
    s();
  }
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
function yield_loop(transport_handle) {
  webrtctransport.unyield = transport_handle;
  console.log("yield call");
}

function query_listener(idListener, idLen) {
  console.error("unimplemented");
}
function next_pending_connected(idListener, idLen) {
  console.error("unimplemented TODO return chanId");
}
function query_new_channel(destId, idLen, transport, chan) {
  console.error("unimplemented");
}
function read_channel_reg(destId, idLen, chanId, chan) {
  console.error("unimplemented");
}
function close_channel(chan) {
  console.error("unimplemented");
}
function write(chan,content,contentLen) {
  console.error("unimplemented return nb write");
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
  for (var i = 0; i < len; i++)        {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
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
webrtctransport.unyield = null;
export default webrtctransport;
