//js mocha test of webrtc server from a client


// browser like environment
import "babel-polyfill";
import btoa from "btoa";
import atob from "atob";
import xmlhttprequest from "xmlhttprequest";
import fetch from "node-fetch";
import wrtc from "wrtc";
import WebSocket from 'ws';
import te from 'text-encoding';
global.fetch = fetch;
global.btoa = btoa;
global.atob = atob;
global.XMLHttpRequest = xmlhttprequest.XMLHttpRequest;
global.RTCSessionDescription = wrtc.RTCSessionDescription;
global.RTCPeerConnection = wrtc.RTCPeerConnection;
global.RTCIceCandidate = wrtc.RTCIceCandidate;
global.WebSocket = WebSocket;
global.TextDecoder = te.TextDecoder;
global.TextEncoder = te.TextEncoder;

global.document = {
        'location' : {
                'href' : 'http://127.0.0.1:3000/',
                'hostname' : '127.0.0.1'
        }
};
var assert = require('chai').assert;
//var assert = require('assert');
import sigrtc from '../static/sigrtc.js';
import webrtctransport from '../static/webrtctransport.js';
 
describe('sigrtc local tests', function() {
  it('should register with signaling server', function(done) {
    var srtc = new sigrtc();
    srtc.registerUser("aa").then(() => {
      done();
    },() => {
      assert.fail();
    });
  });
/*  it('should get stun server', function(done) {
    var srtc = new sigrtc();
    srtc.withStunServer().then(done);
  });*/
  it('should connect two registered', async function() {
    var srtc = new sigrtc();
    var srtcdest = new sigrtc();
    await srtc.registerUser("MQ==");
    await srtcdest.registerUser("Mg==");
    var chan = await srtc.connectWith("Mg==");
    assert.isNotNull(chan);

  });
  it('should transmit data', async function() {
    var srtc = new sigrtc();
    var srtcdest = new sigrtc();
    await srtc.registerUser("MQ==");
    await srtcdest.registerUser("Mg==");
    var chan = await srtc.connectWith("Mg==");
    assert.isNotNull(chan);
    assert.equal(chan.id,0);
    assert.isNotNull(srtc.getSender("Mg==",chan.id));
    await srtc.sendTo("Mg==",chan.id,new Uint8Array([1,2,3]));
  });



});
describe('Array', function() {
  describe('#indexOf()', function() {
    it('should ee', function() {
      assert.equal([1,2,3].indexOf(4), -1);
    });
  });
/*  describe('2', function() {
    it('shouild ee', function() {
      var srtc = new sigrtc();
      webrtctransport.run("bb");
      assert(RTCIceCandidate != null);
      assert.equal([1,2,3].indexOf(4), -1);
    });
  });
*/
});
