
extern crate mime;
extern crate websocket;
extern crate hyper;
extern crate futures;
extern crate tokio_core;
extern crate tk_listen;
extern crate dotenv;
#[macro_use] extern crate dotenv_codegen;

use std::thread;
use std::collections::HashMap;
use websocket::async::server::IntoWs;
use mime::Mime;
use tokio_core::net::{TcpListener, TcpStream};
use hyper::header::ContentLength;
use hyper::header::ContentType;
use hyper::server::{Http, Request, Response, Service};
use hyper::{Method, StatusCode};
use std::ascii::AsciiExt;
use hyper::{Body, Chunk};
use tk_listen::ListenExt;
use std::fmt::Debug;
use std::time::Duration;
use websocket::message::{Message, OwnedMessage};
use websocket::server::InvalidConnection;
use websocket::async::Server;

use tokio_core::reactor::{Handle, Core};
use futures::{Future, Sink, Stream, Select};

use futures::sync::mpsc;
use futures::sync::mpsc::{
  Receiver,
  Sender,
};
use std::net::SocketAddr;
const PHRASE: &'static str = "Hello, World!";
const INDEX_HTML: &'static [u8] = include_bytes!("../static/index.html");

const INDEX_JS: &'static [u8] = include_bytes!("../static/index.js");

const WEBRTCTRANSPORT_JS: &'static [u8] = include_bytes!("../static/webrtctransport.js");

const TRANSPORT_WASM: &'static [u8] = include_bytes!("../../mydht/mydht-externtransport/target/wasm32-unknown-unknown/release/mydht-externtransport.wasm");

pub struct FewStaticInBinContent;

impl Service for FewStaticInBinContent {
    type Request = Request;
    type Response = Response;
    type Error = hyper::Error;
    type Future = Box<Future<Item=Self::Response, Error=Self::Error>>;

    fn call(&self, req: Request) -> Self::Future {
      let mut response = Response::new();
      match (req.method(), req.path()) {
        (&Method::Get, "/")
        | (&Method::Get, "/index.html") => {
          response = response.with_header(ContentLength(INDEX_HTML.len() as u64))
                             .with_body(INDEX_HTML);
        },
        (&Method::Get, "/index.js") => {
          response = response.with_header(ContentLength(INDEX_JS.len() as u64))
                             .with_header(ContentType(mime::TEXT_JAVASCRIPT))
                             .with_body(INDEX_JS);
        },
        (&Method::Get, "/webrtctransport.js") => {
          response = response.with_header(ContentLength(WEBRTCTRANSPORT_JS.len() as u64))
                             .with_header(ContentType(mime::TEXT_JAVASCRIPT))
                             .with_body(WEBRTCTRANSPORT_JS);
        },
        (&Method::Get, "/webrtctransport.wasm") => {
          response = response.with_header(ContentLength(TRANSPORT_WASM.len() as u64))
                             .with_header(ContentType(mime::APPLICATION_OCTET_STREAM))
                             .with_body(TRANSPORT_WASM);
        },
 
        (&Method::Get, "/wsport") => {
          let port = dotenv!("NAT_WEBSOCKET_PORT");
          response = response.with_header(ContentLength(port.len() as u64))
                             .with_body(port);
        },
        (&Method::Get, "/stunserver") => {
          let stun_server = dotenv!("STUN_SERVER");
          response = response.with_header(ContentLength(stun_server.len() as u64))
                             .with_body(stun_server);
        },
        _ => {
          response.set_status(StatusCode::NotFound);
        },
      }
      Box::new(futures::future::ok(response))
    }
}


struct Echo;

fn to_uppercase(chunk: Chunk) -> Chunk {
    let uppered = chunk.iter()
        .map(|byte| byte.to_ascii_uppercase())
        .collect::<Vec<u8>>();
    Chunk::from(uppered)
}

impl Service for Echo {

    type Request = Request;
    
//    type Response = Response;
    type Response = Response<Box<Stream<Item=Chunk, Error=Self::Error>>>;
    type Error = hyper::Error;
    type Future = Box<Future<Item=Self::Response, Error=Self::Error>>;
 
    fn call(&self, req: Request) -> Self::Future {
        let mut response = Response::new();

         match (req.method(), req.path()) {
            (&Method::Get, "/") => {
               // response.set_body("Try POSTing data to /echo");
                let body: Box<Stream<Item=_, Error=_>> = Box::new(Body::from("Try POSTing to /echo!"));
                response.set_body(body);
            },
            (&Method::Post, "/echo") => {
//                response.set_body(req.body());
                let mapping = req.body().map(to_uppercase as fn(Chunk) -> Chunk);
                let body: Box<Stream<Item=_, Error=_>> = Box::new(mapping);
                response.set_body(body);
            },
            _ => {
                response.set_status(StatusCode::NotFound);
            },
        };

        Box::new(futures::future::ok(response))
    }
}



/*fn main() {
  let addr_str = "127.0.0.1:3000";
  println!("Running server on : {}", &addr_str);
  let addr = addr_str.parse().unwrap();
  let server = Http::new().bind(&addr, || Ok(Echo)).unwrap();
  server.run().unwrap();

}*/

#[derive(Debug,Clone)]
pub struct UserPers {
  id : Vec<u8>,
  addr : SocketAddr,
  tx : Sender<Vec<u8>>,
}

const MAX_SIMULTANEOUS_CONNECTIONS : usize = 100;
fn main() {
  let addr_str = dotenv!("ADDRESS_STATIC");
  let addr_str_ws = dotenv!("ADDRESS_WEBSOCKET");
  // curl testing with
  //curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Host: 127.0.0.1" -H "Origin: http://127.0.0.1" -H "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==" -H "Sec-WebSocket-Protocol: any, rust-websocket" -H "Sec-WebSocket-Version: 13" 127.0.0.1:2794 -v
  let addr = addr_str.parse().unwrap();

  let mut core = tokio_core::reactor::Core::new().unwrap();
  let handle = core.handle();

  let serve = Http::new().serve_addr_handle(&addr, &handle, move || Ok(FewStaticInBinContent)).unwrap();
  println!("Listening on http://{} with 1 thread.", serve.incoming_ref().local_addr());

  let h2 = handle.clone();
  // hyper run on core
  handle.spawn(serve.for_each(move |conn| {
      h2.spawn(conn.map(|_| ()).map_err(|err| println!("serve error: {:?}", err)));
      Ok(())
  }).map_err(|_| ()));


  let (tx, rx) = mpsc::channel(100);

	let remote = core.remote();
  // main user mgmt
  thread::spawn(move || {

   let mut users = HashMap::new(); // socket addr and inner struct with id...
   let mut addr_user = HashMap::new(); // socket addr and inner struct with id...
   let remote2 = remote.clone();
   let f = rx.for_each(move|a| {
      //println!("recv : {:?}",&a);
      match a {
        RoutingMsg::REG_USER(addr,user_id, sender) => {
          // TODO chekc if getmut instead of clone
          let f2 = sender.clone().send(vec![1,2,3])
            .map_err(|e|println!("sink error {:?}",e))
            .map(|_|());
          users.insert(user_id.clone(), UserPers {
            id : user_id.clone(),
            addr : addr.clone(),
            tx : sender.clone(), 
          });
          addr_user.insert(addr,(user_id,sender));
          remote2.spawn(|_|f2);
        },
        RoutingMsg::CLOSE_SOCKET(addr) => {
          if let Some((uid,_)) = addr_user.remove(&addr) {
            users.remove(&uid);
          }
        },
        RoutingMsg::FW_SDP(addr,mut dest_id,mut sdp,state) => {
          if let Some(&(ref sender_id, ref sender_tx)) = addr_user.get(&addr) {
            if let Some(ref mut dest_pers) = users.get_mut(&dest_id) {
              let mut m = match state {
                CON_STATE::CONNECT => vec![CONN_QUERY],
                CON_STATE::REPCONNECT => vec![CONN_REP],
                CON_STATE::ICE => vec![ICE_CANDIDATE],
              };
              m.push((sender_id.len() / 256) as u8);
              m.push((sender_id.len() % 256) as u8);
              m.append(&mut sender_id.clone());
              m.append(&mut sdp);
              let f2 = dest_pers.clone().tx.send(m)
              .map_err(|e|println!("sink error {:?}",e))
              .map(|_|());
              remote2.spawn(|_|f2);
            } else {
              let mut m = vec![CONN_WITH_SDP_KO];
              m.append(&mut dest_id);
              let f2 = sender_tx.clone().send(m)
              .map_err(|e|println!("sink error {:?}",e))
              .map(|_|());
              remote2.spawn(|_|f2);
            }
          } else {
            println!("inconsistent connection status : sdp connect receive before user registration");
          }

        },
      }
      Ok(())
    });
    remote.spawn(|_|f);
 
  });
	let handle = core.handle();
/*
	let server = Server::bind(addr_str_ws, &handle).unwrap();



	// a stream of incoming connections
	let f = server.incoming()
        // we don't wanna save the stream if it drops
        .map_err(|InvalidConnection { error, .. }| {
          println!("an error : {:?}",error);
          error
        })
        .for_each(|(upgrade, addr)| {
            println!("Got a connection from: {}", addr);
            // check if it has the protocol we want
            if !upgrade.protocols().iter().any(|s| s == "rust-websocket") {
                println!("Upgrade rejection {:?}",upgrade.protocols());
                // reject it if it doesn't
                spawn_future(upgrade.reject(), &"Upgrade rejection", &handle);
                return Ok(());
            }

            // accept the request to be a ws connection if it does
            let f = upgrade
                .use_protocol("rust-websocket")
                .accept()
                // send a greeting!
                .and_then(|(s, _)| s.send(Message::text("Hello World!").into()))
                // simple echo server impl
                .and_then(|s| {
                    let (sink, stream) = s.split();
                    stream
                    .take_while(|m| Ok(!m.is_close()))
                    .filter_map(|m| {
                        println!("Message from Client: {:?}", m);
                        match m {
                            OwnedMessage::Ping(p) => Some(OwnedMessage::Pong(p)),
                            OwnedMessage::Pong(_) => None,
                            _ => Some(m),
                        }
                    })
                    .forward(sink)
                    .and_then(|(_, sink)| {
                        sink.send(OwnedMessage::Close(None))
                    })
                });

            spawn_future(f, "Client Status", &handle);
            Ok(())
        });

*/


	// bind to the server
  let addr_ws = addr_str_ws.parse().unwrap();
  let server = TcpListener::bind(&addr_ws, &handle).unwrap();


  let protocol = dotenv!("SOCKET_PROTOCOL");

	// a stream of incoming connections 
	let f = server.incoming()
        // tk_listen crate to avoid some panics and also limit conn
        .sleep_on_error(Duration::from_millis(100), &handle)
        .map(|(socket, addr)| {
          println!("Got a connection from: {}", addr);
          let handle2 = handle.clone();
          let tx2 = tx.clone();
          let tx2c = tx.clone();

          spawn_future(socket.into_ws().map(move |upgrade| {
            // check if it has the protocol we want
            if !upgrade.protocols().iter().any(|s| s == protocol) {
                println!("Upgrade rejection {:?}",upgrade.protocols());
                // reject it if it doesn't
                spawn_future(upgrade.reject(), &"Websocket rejection", &handle2);
            } else {

            let handle3 = handle2.clone();
            let handle3c = handle2.clone();

                        // accept the request to be a ws connection if it does
            let f = upgrade
                .use_protocol(protocol)
                .accept()
                // send a greeting!
//                .and_then(|(s, _)| s.send(Message::text("Hello World!").into()))
                // simple echo server impl
                .and_then(move |(s,_h)| {
                  let (sink, stream) = s.split();
                  let (to_route,from_route) = mpsc::channel(10);
                  let to_routec = to_route.clone();
                  let s2 = from_route
                  .take_while(|m : &Vec<u8>| Ok(m.len() > 0)) // close with empty message
                  .map_err(|e| {
                    println!("Error when receiving message from route thread : {:?}",e);
                    websocket::WebSocketError::ProtocolError("Routing of message from service failure")
                  })
                  .filter_map(|m| {
                    println!("forward msg from routing");
                    Some(OwnedMessage::Binary(m))
                  });
                  let s1 = stream
                  .take_while(move|m| {
                    if m.is_close() {
                      let tx3 = tx2c.clone();
                      spawn_future(tx3.send(RoutingMsg::CLOSE_SOCKET(addr)),"Send close socket msg", &handle3c);
                      spawn_future(to_routec.clone().send(Vec::new()),"Send close channel msg", &handle3c);
                      Ok(false)
                    }  else {
                      Ok(true)
                    }
                  })
                  .filter_map(move |m| {
                     let tx3 = tx2.clone();
                     println!("Message from Client: {:?}", m);
                     match m {
                       OwnedMessage::Ping(p) => Some(OwnedMessage::Pong(p)),
                       OwnedMessage::Pong(_) => None,
                       OwnedMessage::Binary(mut b) => {
                         if b.len() > 0 {
                           let type_msg = b.remove(0);
                           match type_msg {
                             REG_USER => {
                               spawn_future(tx3.send(RoutingMsg::REG_USER(addr,b,to_route.clone())),"Send reg msg", &handle3);
                               Some(OwnedMessage::Binary(vec![REG_USER_OK]))
                             },
                             CONN_WITH_SDP 
                             | ICE_CANDIDATE 
                             | CONNREP_WITH_SDP => {
                               let l_sid = (b[0] as usize) * 256 + (b[1] as usize);
                               let mut sid = b.split_off(2);
                               let sdp = sid.split_off(l_sid);
                               let state = match type_msg {
                                 CONN_WITH_SDP => CON_STATE::CONNECT,
                                 CONNREP_WITH_SDP => CON_STATE::REPCONNECT,
                                 ICE_CANDIDATE => CON_STATE::ICE,
                                 _ => unreachable!(),
                               };
                               spawn_future(tx3.send(RoutingMsg::FW_SDP(addr,sid,sdp, state)),"Send reg msg", &handle3);
                               None
                             },
                             _ => None,
                           }
                         } else {
                           None
                         }
                       },
                       _ => Some(m),
                     }
                  });
                  s2.select(s1).forward(sink)
                  //s1.forward(sink)
                  .and_then(|(_, sink)| {
                    // TODO should not send anymore due to select on s2
                    sink.send(OwnedMessage::Close(None))
                  })
                });

                spawn_future(f, "Client Websocket", &handle2);
            }
            let r : Result<_,()> = Ok(());
            r
          }),"Tcp socket into ws",&handle);
          Ok(())
        })
        .listen(MAX_SIMULTANEOUS_CONNECTIONS);

	core.run(f).unwrap();
 // core.run(futures::future::empty::<(), ()>()).unwrap();
}

const REG_USER : u8 = 1;
const REG_USER_OK : u8 = 2;
const CONN_WITH_SDP : u8 = 3;
const CONN_WITH_SDP_KO : u8 = 4;
const CONN_QUERY : u8 = 5;
const CONNREP_WITH_SDP : u8 = 6;
const CONN_REP : u8 = 7;
const ICE_CANDIDATE : u8 = 8;

#[derive(Debug)]
pub enum RoutingMsg {
  CLOSE_SOCKET(SocketAddr),
  REG_USER(SocketAddr,Vec<u8>,Sender<Vec<u8>>),
  FW_SDP(SocketAddr,Vec<u8>,Vec<u8>,CON_STATE),
}
#[derive(Debug)]
pub enum CON_STATE {
  CONNECT,
  REPCONNECT,
  ICE,
}

fn register_user(userid : Vec<u8>, users : &mut HashMap<Vec<u8>,()>) {
  println!("register : {:?}",userid);

  if users.contains_key(&userid) {
    println!("reregister : {:?}",userid);
  }
  users.insert(userid,());
}

fn spawn_future<F, I, E>(f: F, desc: &'static str, handle: &Handle)
	where F: Future<Item = I, Error = E> + 'static,
	      E: Debug
{
	handle.spawn(f.map_err(move |e| println!("{}: '{:?}'", desc, e))
	              .map(move |_| println!("{}: Finished.", desc)));
}
