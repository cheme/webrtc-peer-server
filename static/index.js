let signalwebrtc = {
}

function iceCallback (a) {
  console.log(a);
}
function iceGatheringStateChange (a) {
  console.log ('state change');
  console.log(a);
}


function connectSocket (cb) {
  let xhr = new XMLHttpRequest();
  xhr.responseType = 'text';
  xhr.onload = () => {
    let address = 'ws://' + document.location.hostname + ':' + xhr.response;
    var connection = new WebSocket(address, ['webrtcsignaling', 'rust-websocket']);
    connection.onopen = function () {
      if (signalwebrtc.websocket == null ||
        signalwebrtc.websocket.readyState != 1) {
              signalwebrtc.websocket = connection;
      } else {
        // single socket usage
        connection.close();
      }
      if (cb != null) {
        cb(signalwebrtc.websocket);
      }
    }
    connection.onerror = function (event) {
      console.log('ws error : ' + event);
    }
    connection.onmessage = function (event) {
      handleSocketMessage(event.data);
    }
  }

  xhr.open('GET',"./wsport");
  xhr.send();
}

function handleSocketMessage(data) {
  if (data instanceof Blob) {
    let fileReader = new FileReader();
    fileReader.onload = function() {
      receiveSocketBytes(new Uint8Array(this.result));
    }
    fileReader.readAsArrayBuffer(data);
  } else {
    console.log(data);
  }
}

function receiveSocketBytes(bytes) {
  switch (bytes[0]) {
    case MESSAGE_CODES.REG_USER_OK :
      if (signalwebrtc.onRegisterUser != null) {
        signalwebrtc.onRegisterUser();
      }
    break;
    default:
      console.log("Unmanaged message from server : " + bytes);
  }
}
function wsSend(c) {
 if (signalwebrtc.websocket == null ||
     signalwebrtc.websocket.readyState != 1) {
   connectSocket(function(con) { 
     con.send(c) 
   });
 } else {
   signalwebrtc.websocket.send(c);
 }
}

function registerUser (userId, cb) {
  signalwebrtc.userId = userId;
  let b = base64ToByteMsg(userId,MESSAGE_CODES.REG_USER);
  if (cb != null) {
    signalwebrtc.onRegisterUser = cb;
  }
  wsSend(b);
}

const MESSAGE_CODES = {
  REG_USER : 1,
  REG_USER_OK : 2
}

function base64ToByteMsg(base64, code) {
  let binary_string =  atob(base64);
  let len = binary_string.length;
  let bytes = new Uint8Array(len + 1);
  bytes[0] = code;
  for (var i = 1; i < len; i++)        {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

function newStunCandidate () {
  if (signalwebrtc.stunServer != null) {
    queryCandidate();
  }
  let xhr = new XMLHttpRequest();
  xhr.responseType = 'text';
  xhr.onload = () => {
    signalwebrtc.stunServer = xhr.response;
    queryCandidate();
  }
  
  xhr.open('GET',"./stunserver");
  xhr.send();
}

function queryCandidate () {
  if (signalwebrtc.rtcPeerConnection == null) {
    var config = {
      iceServers: [{url :signalwebrtc.stunServer}],
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: '0'
    };
    signalwebrtc.rtcPeerConnection = new RTCPeerConnection(config);
    signalwebrtc.rtcPeerConnection.onicecandidate = iceCallback;
    signalwebrtc.rtcPeerConnection.onicecandidate = iceGatheringStateChange;
  }
  signalwebrtc.rtcPeerConnection.createOffer(
      //{offerToReceiveAudio: 1}
  ).then(
    gotDescription,
    noDescription
  );
}

function gotDescription(desc) {
  signalwebrtc.rtcPeerConnection.setLocalDescription(desc);
}

function noDescription(error) {
  console.log('Error creating offer: ', error);
}

signalwebrtc.connectSocket = connectSocket;
signalwebrtc.newStunCandidate = newStunCandidate;
signalwebrtc.registerUser = registerUser;

export default signalwebrtc;
