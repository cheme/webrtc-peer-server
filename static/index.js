let signalwebrtc = {
  rtcPeerConnections : {}
}

function iceCallback (a,b) {
  console.log(a);
}
function iceGatheringStateChangeQuery (a,pc, userdestId) {
  console.log ('state change');
  console.log(a);
  if (pc.iceGatheringState == "complete") {
  console.log('gathComplet');
      pc.createOffer().then(
      (a) => {
        pc.setLocalDescription(a);
        let msg = sendsdptoid(userdestId, a.sdp, MESSAGE_CODES.CONN_WITH_SDP);
        wsSend(msg);
      },
      (e) => {
        console.log("Error local connect");
        console.log(e);
      }
    );
  }
}
function iceGatheringStateChangeReply (a,pc, userdestId) {
  console.log ('state change');
  console.log(a);
  if (pc.iceGatheringState == "complete") {
  console.log('gathComplet2');
      pc.createAnswer().then(
      (a) => {
      if (pc.signalingState !== 'stable') {
        pc.setLocalDescription(a);
      }
        let msg = sendsdptoid(userdestId, a.sdp, MESSAGE_CODES.CONNREP_WITH_SDP);
        wsSend(msg);
      },
      (e) => {
        console.log("Error local connect");
        console.log(e);
      }
    );
  }
}



function connectSocket (cb) {
  let xhr = new XMLHttpRequest();
  xhr.responseType = 'text';
  xhr.onload = () => {
    let address = 'ws://' + document.location.hostname + ':' + xhr.response;
    var connection = new WebSocket(address, ['webrtcsignaling', 'rust-websocket']);
    connection.onopen = () => {
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
    connection.onerror = (event) => {
      console.log('ws error : ' + event);
    }
    connection.onmessage = (event) => {
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

      signalwebrtc.userId = signalwebrtc.userIdUnderReg;
      signalwebrtc.userIdUnderReg = null;

      if (signalwebrtc.onRegisterUser != null) {
        signalwebrtc.onRegisterUser();
      }
    break;

  // : 4,
  //CONN_QUERY : 5
    case MESSAGE_CODES.CONN_WITH_SDP_KO :
//      let senderidsize = bytes[1] * 256 + bytes[2];
//      let senderid = btoa(bytes.slice(3..3+senderidsize));
//      let counter = bytes[3+senderidsize] * 256 + bytes[4+senderidsize];
      //let destid = btoa(bytes.slice(5+senderidsize));
      let destid = btoa(new TextDecoder().decode(bytes.slice(1)));
      signalwebrtc.rtcPeerConnections[destid] = null;
    break;
    case MESSAGE_CODES.CONN_QUERY : {
      let fromLen = bytes[1] * 256 + bytes[2];
      let fromId = btoa(new TextDecoder().decode(bytes.slice(3,3+fromLen)));
      let sdp = new TextDecoder().decode(bytes.slice(3+fromLen));
      let desc = new RTCSessionDescription();
      desc.type = 'offer';
      desc.sdp = sdp;
      recConQuery(fromId,desc);
    }
    break;
    case MESSAGE_CODES.CONN_REP : {
      let fromLen = bytes[1] * 256 + bytes[2];
      let fromId = btoa(new TextDecoder().decode(bytes.slice(3,3+fromLen)));
      let sdp = new TextDecoder().decode(bytes.slice(3+fromLen));
      let desc = new RTCSessionDescription();
      desc.type = 'answer';
      desc.sdp = sdp;
      recConReply(fromId,desc);
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
  if (signalwebrtc.userIdUnderReg != null) {
    console.log("registering user while another register action is in progress");
    // return // allow it
  }
  signalwebrtc.userIdUnderReg = userId;
  let b = base64ToByteMsg(userId,MESSAGE_CODES.REG_USER);
  if (cb != null) {
    signalwebrtc.onRegisterUser = cb;
  }
  wsSend(b);
}
function withStunServer (cb) {
  if (signalwebrtc.stunServer != null) {
    cb();
  } else {
    let xhr = new XMLHttpRequest();
    xhr.responseType = 'text';
    xhr.onload = () => {
      signalwebrtc.stunServer = xhr.response;
      cb();
    }

    xhr.open('GET',"./stunserver");
    xhr.send();
  }
}
function connectWith(userdestId, cb) {
  if (signalwebrtc.userId == null) {
    console.log("Trying to connect while not registered");
    return;
  }
  withStunServer (() => {
    let iceInit = false;
    if (signalwebrtc.rtcPeerConnections[userdestId] == null) {
      let config = {
        iceServers: [{url :signalwebrtc.stunServer}],
        iceTransportPolicy: 'all',
        iceCandidatePoolSize: '0'
      };

      let pc = new RTCPeerConnection(config);
      pc.onicecandidate = (a) => iceGatheringStateChangeQuery(a,pc, userdestId);
      pc.ondatachannel = onDataChannel;
      pc.chanCounter = 0;
      pc.channels = {};
      signalwebrtc.rtcPeerConnections[userdestId] = pc;
      iceInit = true;
    }
    let pc = signalwebrtc.rtcPeerConnections[userdestId];
    let dataConstraint = null;// TODO??
    let counter = pc.chanCounter;
    pc.chanCounter += 1;
    let sendChannel = pc.createDataChannel(userdestId + counter.toString(),
      dataConstraint);
    sendChannel.onopen = () => onSendChannelStateChange(sendChannel,cb);
    sendChannel.onclose = () => onSendChannelStateChange(sendChannel);
    sendChannel.onmessage = onChannelMessage;

    sendChannel.counter = counter;
    pc.channels[counter.toString()] = sendChannel;

    if (pc.iceConnectionState !== 'completed') {
      pc.createOffer().then(
        (a) => {
          pc.setLocalDescription(a);
          let msg = sendsdptoid(userdestId, a.sdp, MESSAGE_CODES.CONN_WITH_SDP);
          //let msg = sendsdptoid(userdestId, counter, a.sdp, MESSAGE_CODES.CONN_WITH_SDP);
          //if (!iceInit) {
          wsSend(msg);
          //}
        },
        (e) => {
          console.log("Error local connect");
          console.log(e);
        }
      );
    }
  });
 
}

function recConQuery(fromId, offer) {
  withStunServer (() => {
    let iceInit = false;
    if (signalwebrtc.rtcPeerConnections[fromId] == null) {
      let config = {
        iceServers: [{url :signalwebrtc.stunServer}],
        iceTransportPolicy: 'all',
        iceCandidatePoolSize: '0'
      };

      let pc = new RTCPeerConnection(config);
      pc.onicecandidate = (a) => iceGatheringStateChangeReply(a,pc, fromId);
      pc.ondatachannel = onDataChannel;
      pc.chanCounter = 0;
      pc.channels = {};
      signalwebrtc.rtcPeerConnections[fromId] = pc;
      iceInit = true;
    }
    let pc = signalwebrtc.rtcPeerConnections[fromId];
    pc.setRemoteDescription(offer);
    if (!iceInit) {
    pc.createAnswer().then(
      (a) => {
        pc.setLocalDescription(a);
        let msg = sendsdptoid(fromId, a.sdp, MESSAGE_CODES.CONNREP_WITH_SDP);
          wsSend(msg);
      },
      (e) => {
        console.log("Error dist connect");
        console.log(e);
      }
    );
    }
  });
}

function recConReply(fromId, answer) {
  withStunServer (() => {
    if (signalwebrtc.rtcPeerConnections[fromId] == null) {
      console.log("received answer when no offer has been made, ignoring");
      return;
    }
    let pc = signalwebrtc.rtcPeerConnections[fromId];

    if (pc.signalingState !== 'stable') {
      pc.setRemoteDescription(answer);
    }
  });
}


function onSendChannelStateChange(sendChannel,cb) {
  var readyState = sendChannel.readyState;
  console.log('Send channel state is: ' + readyState);
  if (readyState === 'open') {

    if (cb != null) {
      cb(sendChannel)
    }
    
  } else {
  }
}

function onDataChannel(event) {
  let counter = this.chanCounter;
  this.chanCounter += 1;
  event.channel.onopen = () => onSendChannelStateChange(event.channel);
  event.channel.onclose = () => onSendChannelStateChange(event.channel);
  event.channel.onmessage = onChannelMessage;
  this.channels[counter.toString()] = event.channel;
}
function onChannelMessage(event) {
  console.log(event);
}
const MESSAGE_CODES = {
  REG_USER : 1,
  REG_USER_OK : 2,
  CONN_WITH_SDP : 3,
  CONN_WITH_SDP_KO : 4,
  CONN_QUERY : 5,
  CONNREP_WITH_SDP : 6,
  CONN_REP : 7
}

function sendsdptoid(destid, sdp, code) {
  let byteSdp = new TextEncoder("utf-8").encode(sdp);
  let binaryid = atob(destid);
  let len = binaryid.length + byteSdp.length + 3;
  let bytes = new Uint8Array(len);
  bytes[0] = code;
/*  bytes[1] = counter / 256;
  bytes[2] = counter % 256;
  bytes[3] = binaryid.length / 256;
  bytes[4] = binaryid.length % 256;*/
  bytes[1] = binaryid.length / 256;
  bytes[2] = binaryid.length % 256;
  for (var i = 0; i < binaryid.length; i++) {
    bytes[i+3] = binaryid.charCodeAt(i);
  }
  bytes.set(byteSdp, 3 + binaryid.length);
  return bytes.buffer;
}


function base64ToByteMsg(base64, code) {
  let binary_string =  atob(base64);
  let len = binary_string.length;
  let bytes = new Uint8Array(len + 1);
  bytes[0] = code;
  for (var i = 0; i < len; i++)        {
    bytes[i+1] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}


signalwebrtc.connectSocket = connectSocket;
signalwebrtc.registerUser = registerUser;
signalwebrtc.connectWith = connectWith;

export default signalwebrtc;
