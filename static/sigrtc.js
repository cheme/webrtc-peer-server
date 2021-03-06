function newSigwebrtc() {

/*let signalwebrtc = {
  rtcPeerConnections : {},
  orphanCandidate : {}
}*/
let signalwebrtc = this;
signalwebrtc.rtcPeerConnections = {};
signalwebrtc.orphanCandidate = {};
signalwebrtc.pendingConnection = [];
// TODO testing with higher vals
let bufferFullThreshold = 65536;
function iceCallback (a,b) {
  console.log(a);
}
function log_error(e) {
  console.error("Error : " + e);
}

function iceGatheringStateChange (a, userdestId) {
  console.log ('ice state change');
  if (a.candidate != null) {
    let msg = sendsdptoid(userdestId, a.candidate.candidate, MESSAGE_CODES.ICE_CANDIDATE);
    wsSend(msg);
  }
}

/*function iceGatheringStateChangeQuery (a,pc, userdestId) {
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
}*/


// TODO error cb (switch to native promise)
function connectSocket () {
  return new Promise((cb,cberr) => {
  fetch(document.location.href + 'wsport')
    .then(response => response.text(),cberr)
    .then(response => {
    let address = 'ws://' + document.location.hostname + ':' + response;
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
            // TODO callback it (use promise everywhere)
      console.log('ws error on connection at ' + address + ' : ' + event);
      if (cberr != null) {
        cberr(event);
      }
    }
    connection.onmessage = (event) => {
      handleSocketMessage(event.data);
    }
  },cberr);
  });
}

function handleSocketMessage(data) {
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    let fileReader = new FileReader();
    fileReader.onload = function() {
      receiveSocketBytes(new Uint8Array(this.result));
    }
    fileReader.readAsArrayBuffer(data);
  } else if (data instanceof Uint8Array) {
    receiveSocketBytes(data);
  } else if (data instanceof ArrayBuffer) {
    receiveSocketBytes(new Uint8Array(data));
  } else {
    console.error("receive non blob from websocket");
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
      for (let pendcon of signalwebrtc.pendingConnection) {
        connectWith(pendcon[0],pendcon[1],pendcon[2]).then(pendcon[3],pendcon[4]);
      }
      signalwebrtc.pendingConnection = [];

    break;

  // : 4,
  //CONN_QUERY : 5
    case MESSAGE_CODES.CONN_WITH_SDP_KO :
//      let senderidsize = bytes[1] * 256 + bytes[2];
//      let senderid = btoa(bytes.slice(3..3+senderidsize));
//      let counter = bytes[3+senderidsize] * 256 + bytes[4+senderidsize];
      //let destId = btoa(bytes.slice(5+senderidsize));
      let destId = btoa(new TextDecoder().decode(bytes.slice(1)));
      signalwebrtc.rtcPeerConnections[destId] = null;
    break;
    case MESSAGE_CODES.CONN_QUERY : {
      let fromLen = bytes[1] * 256 + bytes[2];
      let fromId = btoa(new TextDecoder().decode(bytes.slice(3,3+fromLen)));
      let sdp = new TextDecoder().decode(bytes.slice(3+fromLen));
      let desc = new RTCSessionDescription({
        type : 'offer',
        sdp : sdp
      });
      recConQuery(fromId,desc);
    }
    break;
    case MESSAGE_CODES.CONN_REP : {
      let fromLen = bytes[1] * 256 + bytes[2];
      let fromId = btoa(new TextDecoder().decode(bytes.slice(3,3+fromLen)));
      let sdp = new TextDecoder().decode(bytes.slice(3+fromLen));
      let desc = new RTCSessionDescription({
        type : 'answer',
        sdp : sdp
      });
      recConReply(fromId,desc);
    }
    break;
    case MESSAGE_CODES.ICE_CANDIDATE : {
      let fromLen = bytes[1] * 256 + bytes[2];
      let fromId = btoa(new TextDecoder().decode(bytes.slice(3,3+fromLen)));
      let icesdp = new TextDecoder().decode(bytes.slice(3+fromLen));
      recCandidate(fromId,icesdp);

    }
    break;
 
    default:
      console.log("Unmanaged message from server : " + bytes[1]);
  }
}
function wsSend(c,cberr) {
 var s = (con) => {
   try {
     con.send(c)
   } catch (e) {
     console.error(e);
     if (cberr != null) {
       cberr(e);
     }
   }
 };
 if (signalwebrtc.websocket == null ||
     signalwebrtc.websocket.readyState != 1) {
   connectSocket()
     .then(s,() => { if (cberr != null) {
       cberr()
     }});
 } else {
   s(signalwebrtc.websocket);
 }
}

function registerUser(userId) {
  return new Promise((cb,cberr) => {
    if (signalwebrtc.userIdUnderReg != null) {
      console.log("registering user while another register action is in progress");
      // return // allow it 
    }
    signalwebrtc.userIdUnderReg = userId;
    let b = base64ToByteMsg(userId,MESSAGE_CODES.REG_USER);
    if (cb != null) {
      signalwebrtc.onRegisterUser = cb;
    }
    wsSend(b,cberr);
  });
}
function withStunServer() {
  return new Promise((cb,cberr) => {
  if (signalwebrtc.stunServer != null) {
    cb();
  } else {
    fetch(document.location.href + 'stunserver')
    .then(response => response.text(),cberr)
    .then(response => {
      signalwebrtc.stunServer = response;
      cb();
    },cberr);
  }
  });
}

function connectWith(userdestId,cbclose,cbmessage) {
  return new Promise((cb,cberr) => {
  if (signalwebrtc.userId == null) {
    // this case will happen a lot : call connect ws from wasm then call connect to from wasm imediatly
    console.log("Trying to connect while not registered, pending connection");
    signalwebrtc.pendingConnection.push([userdestId,cbclose,cbmessage,cb,cberr]);
    return;
  }
  withStunServer().then(() => {
    let iceInit = false;
    if (signalwebrtc.rtcPeerConnections[userdestId] == null) {
      let config = {
        iceServers: [{urls :signalwebrtc.stunServer}],
        iceTransportPolicy: 'all',
        iceCandidatePoolSize: '0'
      };

      let pc = new RTCPeerConnection(config);
      pc.onicecandidate = (a) => iceGatheringStateChange(a,userdestId);
      //pc.onicecandidate = (a) => iceGatheringStateChangeQuery(a,pc, userdestId);
      pc.ondatachannel = onDataChannel;
      pc.chanCounter = 0;
      pc.channels = {};
      pc.destId = userdestId;
      signalwebrtc.rtcPeerConnections[userdestId] = pc;
      iceInit = true;
    }
    let pc = signalwebrtc.rtcPeerConnections[userdestId];
    let dataConstraint = { ordered : true };
    if (pc.iceConnectionState !== 'completed') { // dubious
      dataConstraint = { id : pc.chanCounter, ordered : true }; // default, useless
      pc.chanCounter += 1;
    }
    let sendChannel = pc.createDataChannel(userdestId,
      dataConstraint);
    sendChannel.binaryType = 'arraybuffer';
    sendChannel.onopen = () => onChannelOpen(sendChannel,cb);
    sendChannel.onclose = () => onChannelClose(pc,sendChannel,cbclose);
    sendChannel.onmessage = (event) => onChannelMessage(event,sendChannel,cbmessage);

    pc.channels[sendChannel.id] = sendChannel;

    if (pc.iceConnectionState !== 'completed') {
      pc.createOffer().then(
        (a) => {
          pc.setLocalDescription(a);
          pc.mid = getMidFromSdp(a.sdp);
          let msg = sendsdptoid(userdestId, a.sdp, MESSAGE_CODES.CONN_WITH_SDP);
          //let msg = sendsdptoid(userdestId, counter, a.sdp, MESSAGE_CODES.CONN_WITH_SDP);
          //if (!iceInit) {
          wsSend(msg);
          //}
        },
        (e) => {
          console.log("Error local connect");
          console.log(e);
          cberr();
        }
      );
    }
  },cberr);
  });
 
}

function getSender(destId,counter) {
  let pc = signalwebrtc.rtcPeerConnections[destId];
  if (pc != null) {
    for (let key in pc.channels) {
      if (counter == null || key === counter.toString()) {
        return pc.channels[key];
      }
    }
  }
  return null;
}
// TODO refactor : destid + nullable counter should be replaced by an uint key internally and expose this 
// interface
function sendTo(destId,counter,data) {
  new Promise((cb,cberr) => {
  let sender = getSender(destId,counter);
  if (sender == null) {
    if (cberr != null) {
      cberr("No sender"); // TODO replace with invalid state error
      return;
    }
    return;
  }
  try {

    let toSendLength = data.byteLength;
    let sentLength = 0;
    // arraybuff or uint8array
    // code from sample with two kind of buff size mgmt TODO polling might not be needed anymor
          // TODO test on other browser
    var usePolling = true;
    if (typeof sender.bufferedAmountLowThreshold === 'number') {
      console.log('Using the bufferedamountlow event for flow control');
      usePolling = false;
      sender.bufferedAmountLowThreshold = bufferFullThreshold;
    }
    var listener = function() {
      sender.removeEventListener('bufferedamountlow', listener);
      sendAllData();
    };
    var sendAllData = function() {
      let toSendIt = Math.min(bufferFullThreshold - sender.bufferedAmount, toSendLength - sentLength);
      while (sentLength < toSendLength) {
        if (sender.bufferedAmount >= bufferFullThreshold) {
          if (usePolling) {
            // delay send
            setTimeout(sendAllData, 250);
          } else {
            // kinda flush but more like while(1) upt to no more event loop : idea for a transport flush implementation?
            sender.addEventListener('bufferedamountlow', listener);
          }
          return;
        }
        let sentLength1 = sentLength;
        sentLength += toSendIt;
        sender.send(data.slice(sentLength1,sentLength));
      }
      if (cb != null) {
        cb()
      }
    };
    setTimeout(sendAllData,0);
    //sender.send(data);
  } catch (e) {
    // InvalidStateError (wrong state)
    // NetworkError (data to big TODO avoid it as it is said to close the channel) + TODO reinit chan somehow
    // TypeError (data to large for receiver : here single data type targetted)
    console.log(e);
    if (cberr != null) {
      cberr(e);
    }
  }
});
}



function recConQuery(fromId, offer) {
  withStunServer().then(() => {
    let iceInit = false;
    if (signalwebrtc.rtcPeerConnections[fromId] == null) {
      let config = {
        iceServers: [{urls :signalwebrtc.stunServer}],
        iceTransportPolicy: 'all',
        iceCandidatePoolSize: '0'
      };

      let pc = new RTCPeerConnection(config);
      pc.onicecandidate = (a) => iceGatheringStateChange(a,fromId);
      pc.ondatachannel = onDataChannel;
      pc.chanCounter = 0;
      pc.channels = {};
      pc.destId = fromId;
      signalwebrtc.rtcPeerConnections[fromId] = pc;
      iceInit = true;
    }
    let pc = signalwebrtc.rtcPeerConnections[fromId];
    pc.setRemoteDescription(offer);
    pc.mid = getMidFromSdp(offer.sdp);
    if (signalwebrtc.orphanCandidate[fromId] != null) {
      let cs = signalwebrtc.orphanCandidate[fromId];
      for (let csc of cs) {
        recCandidate(fromId, csc);
      }
      signalwebrtc.orphanCandidate[fromId] = null;
    }
    //if (!iceInit) {
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
    //}
  },log_error);
}

function recConReply(fromId, answer) {
  if (signalwebrtc.rtcPeerConnections[fromId] == null) {
    console.log("received answer when no offer has been made, ignoring " + fromId);
    return;
  }
  let pc = signalwebrtc.rtcPeerConnections[fromId];

  if (pc.signalingState !== 'stable') {
    pc.setRemoteDescription(answer);
  }
}
function recCandidate(fromId, icesdp) {
  if (signalwebrtc.rtcPeerConnections[fromId] == null) {
    console.log("received candidate when no offer has been made, storing " + fromId);
    if (signalwebrtc.orphanCandidate[fromId] == null) {
      signalwebrtc.orphanCandidate[fromId] = [];
    }
    signalwebrtc.orphanCandidate[fromId].push(icesdp);
    return;
  }
  let pc = signalwebrtc.rtcPeerConnections[fromId];

  let sdpMid = 'data';
  if (pc.mid != null) {
    sdpMid= pc.mid;
  }

  let candidate2 = new RTCIceCandidate({candidate : icesdp, sdpMid : sdpMid, sdpMLineIndex : 0});

  pc.addIceCandidate(candidate2);
}

function getMidFromSdp (sdp) {
  var mids = [];
  // TODO better regexp
  sdp.split('\n').forEach((s) => {
    var match = s.match(/^a=mid:(\S+)\s*$/);
    if (match) {
      mids.push(match[1]);
    }
  });

  if (mids.length !== 1) {
    console.log("no mid likely to be an issue using 'data' as default");
    return 'data';
  }
  return mids[0];
}


function onChannelClose(pc,sendChannel,cbclose) {
  pc.channels[sendChannel.id] = null;

  if (cbclose != null) {
    cbclose(pc,sendChannel);
  }
}
function onChannelOpen(sendChannel,cb) {
  var readyState = sendChannel.readyState;
  console.log('Send channel state is: ' + readyState);
  if (readyState === 'open') {
    if (cb != null) {
      cb(sendChannel)
    }
  } else {
    console.error("Invalid state on channel open : ignoring");
  }
}

function onDataChannel(event) {
  
  event.channel.onopen = () => onChannelOpen(event.channel,signalwebrtc.ondatachannelopencb);
  event.channel.onclose = () => onChannelClose(this,event.channel);
  event.channel.onmessage = (ev) => onChannelMessage(ev, event.channel);
  this.channels[event.channel.id] = event.channel;
}
function onChannelMessage(event,sendChannel,cbmessage) {
  console.log(event);
  if (cbmessage != null) {
    cbmessage(event,sendChannel);
  }
}
const MESSAGE_CODES = {
  REG_USER : 1,
  REG_USER_OK : 2,
  CONN_WITH_SDP : 3,
  CONN_WITH_SDP_KO : 4,
  CONN_QUERY : 5,
  CONNREP_WITH_SDP : 6,
  CONN_REP : 7,
  ICE_CANDIDATE : 8
}

function sendsdptoid(destId, sdp, code) {
  let byteSdp = new TextEncoder("utf-8").encode(sdp);
  let binaryid = atob(destId);
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

signalwebrtc.setBufferFullTreshold = function(newT) {
  bufferFullThreshold = newT;
};

signalwebrtc.connectSocket = connectSocket;
signalwebrtc.registerUser = registerUser;
signalwebrtc.connectWith = connectWith;
signalwebrtc.getSender = getSender;
signalwebrtc.sendTo = sendTo;
//signalwebrtc.withStunServer = withStunServer;

}

export default newSigwebrtc;
