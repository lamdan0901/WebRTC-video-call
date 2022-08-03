import React, { useRef, useEffect, useState } from "react";
import io from "socket.io-client";
import { v1 as uuid } from "uuid";

//* signalling flow:
/**
 * A sends connection req to server -> create a room.
 *
 * B joins the room, sends connection req to server -> join current room.
 * Server: notify A that B joined the room and send other's info to both.
 * A n B receive the info.
 *
 * B: init peer -> start negotiation (create offer, set local desc,...)
 * -> send offer to B through server.
 * Server: send offer to A.
 * A: receive offer -> create and send answer to B through server.
 * Server: send answer to B.
 * B: receive answer, start to exchange icecandidate and tracks with A.
 *
 * Now both are connected
 */

const constraints = {
  video: {
    width: { min: 480, ideal: 640, max: 720 },
    height: { min: 320, ideal: 480, max: 640 },
  },
  audio: true,
};

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun2.1.google.com:19302" },
    {
      urls: "turn:192.158.29.39:3478?transport=udp",
      credential: "JZEOEt2V3Qb0y27GRntt2u2PAYA=",
      username: "28224511:1379330808",
    },
    {
      urls: "turn:192.158.29.39:3478?transport=tcp",
      credential: "JZEOEt2V3Qb0y27GRntt2u2PAYA=",
      username: "28224511:1379330808",
    },
  ],
};

const Room = ({ match }) => {
  const [remoteVideos, setRemoteVideos] = useState([]);
  // const [remoteScreens, setRemoteScreens] = useState([]);

  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [isSharingScreen, setIsSharingScreen] = useState(false);

  const [text, setText] = useState("");
  const [messages, setMessages] = useState([]);

  const userVideo = useRef();
  const userStream = useRef();
  const userScreenShare = useRef();

  const peerRef = useRef();
  const partnerID = useRef([]);

  const socketRef = useRef();
  const dataChannelRef = useRef();

  useEffect(() => {
    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      userVideo.current.srcObject = stream;
      userStream.current = stream;

      console.log("my stream id:", stream.id);

      socketRef.current = io.connect("/");

      socketRef.current.emit("join room", match.params.roomID);

      socketRef.current.on("joined room", () => {
        peerRef.current = createPeer();
        createDataChannel();
        addTracks();
      });

      socketRef.current.on("other users in the room", (otherUsers) => {
        console.log("other users in the room", otherUsers);
        peerRef.current = createPeer();
        createDataChannel();
        addTracks();
        partnerID.current = otherUsers;
      });

      socketRef.current.on("new user joined", (userID) => {
        partnerID.current.push(userID);
        console.log("new user joined", userID);
      });

      // socketRef.current.on("offer", handleOffer);

      socketRef.current.on("answer", handleAnswer);

      socketRef.current.on("ice-candidate", handleICECandidate);

      socketRef.current.on("connect", () => {
        console.log("connected to server");
      });

      socketRef.current.on("stop sharing screen", () => {
        // partnerScreenShare.current.srcObject = null;
        // setIsPartnerSharingScreen(false);
      });

      socketRef.current.on("user left", () => {
        // partnerVideo.current.srcObject = null;
        // if (partnerScreenShare.current.srcObject) {
        //   partnerScreenShare.current.srcObject = null;
        //   setIsPartnerSharingScreen(false);
        // }
        // setPartnerName("");
      });
    });
    // eslint-disable-next-line
  }, []);

  function addTracks() {
    console.log("addTrack called");
    userStream.current.getTracks().forEach((track) => {
      peerRef.current.addTrack(track, userStream.current);
    });
  }

  function createPeer() {
    const peer = new RTCPeerConnection(rtcConfig);
    console.log("create peer");

    peer.onnegotiationneeded = () => handleNegotiationNeeded();

    peer.onicecandidate = (e) => {
      console.log("on icecandidate");
      if (e.candidate) {
        socketRef.current.emit("ice-candidate", e.candidate);
      }
    };

    peer.ontrack = (e) => {
      console.log("peer.ontrack called");
      // console.log(e.streams.length);
      // e.streams.forEach((stream) => {
      //   console.log("e.streams", stream.id);
      // });

      setRemoteVideos((prev) => {
        const newStreams = [];

        e.streams.forEach((stream) => {
          const isDuplicated = prev.find((p) => p.id === stream.id);
          if (!isDuplicated) {
            newStreams.push(stream);
          }
        });

        return newStreams.length === 0 ? prev : [...prev, ...newStreams];
      });

      // if (
      //   partnerVideo?.current?.srcObject?.id &&
      //   partnerVideo?.current?.srcObject?.id !== e.streams[0].id
      // ) {
      //   partnerScreenShare.current.srcObject = e.streams[0];
      //   // setIsPartnerSharingScreen(true);
      // } else {
      //   partnerVideo.current.srcObject = e.streams[0];
      // }
    };

    return peer;
  }

  async function handleNegotiationNeeded() {
    console.log("handle Negotiation Needed");

    const offer = await peerRef.current.createOffer();
    await peerRef.current.setLocalDescription(offer);

    const payload = {
      caller: socketRef.current.id,
      sdp: peerRef.current.localDescription,
    };

    socketRef.current.emit("offer", payload);
  }

  function handleAnswer(answer) {
    console.log("handle Answer");
    const desc = new RTCSessionDescription(answer);
    peerRef.current.setRemoteDescription(desc).catch((e) => console.log(e));
  }

  function handleICECandidate(icecandidate) {
    console.log("handle ICECandidate");
    const candidate = new RTCIceCandidate(icecandidate);
    peerRef.current.addIceCandidate(candidate).catch((e) => console.log(e));
  }

  function createDataChannel() {
    dataChannelRef.current = peerRef.current.createDataChannel("dataChannel");

    peerRef.current.ondatachannel = (e) => {
      let recvMsgChannel = e.channel;
      recvMsgChannel.onmessage = (e) =>
        setMessages((messages) => [
          ...messages,
          { yours: false, value: e.data },
        ]);
    };
  }

  function sendMessage() {
    if (dataChannelRef.current.readyState === "open") {
      dataChannelRef.current.send(text);
      setMessages((messages) => [...messages, { yours: true, value: text }]);
      setText("");
    }
  }

  async function shareScreen() {
    if (!peerRef?.current) {
      return;
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      cursor: true,
    });

    const screenTrack = stream.getTracks()[0];
    peerRef.current.addTrack(screenTrack, stream);

    setIsSharingScreen(true);
    userScreenShare.current.srcObject = stream;

    screenTrack.onended = () => {
      stopSharingScreen();
    };
  }

  function stopSharingScreen() {
    userScreenShare.current.srcObject
      .getVideoTracks()
      .forEach((track) => track.stop());
    userScreenShare.current.srcObject = null;

    setIsSharingScreen(false);
    socketRef.current.emit("stop sharing screen", partnerID.current);
  }

  function toggleAudio() {
    userVideo.current.srcObject.getAudioTracks()[0].enabled = !audioEnabled;
    setAudioEnabled(!audioEnabled);
  }

  function toggleVideo() {
    userVideo.current.srcObject.getVideoTracks()[0].enabled = !videoEnabled;
    setVideoEnabled(!videoEnabled);
  }

  function createRoom() {
    peerRef.current.close();
    socketRef.current.emit("trigger disconnect", socketRef.current.id);
    // socketRef.current.emit("create room", socketRef.current.id);
    window.location.href = `/room/${uuid()}`;
  }

  function leaveRoom() {
    peerRef.current.close();
    socketRef.current.emit("trigger disconnect", socketRef.current.id);
    window.location.href = "/";
  }

  window.addEventListener("beforeunload", () =>
    socketRef.current.emit("trigger disconnect")
  );

  const Video = ({ stream, index }) => {
    const ref = useRef();

    useEffect(() => {
      ref.current.srcObject = stream;
      console.log("stream: ", stream.id);
    }, [stream]);

    return (
      <div className="video">
        <span className="username">{`Partner ${index + 1}`}</span>
        <video autoPlay playsInline ref={ref} />
      </div>
    );
  };

  return (
    <div className="container">
      <div className="video-wrapper">
        <div className="video">
          <span className="username">You</span>
          <video autoPlay playsInline ref={userVideo} />
        </div>
        {remoteVideos?.map((remoteVideo, i) => (
          <Video stream={remoteVideo} key={i} index={i} />
        ))}
      </div>

      {/* <div className="video-wrapper">
        <video
          className={isSharingScreen ? "screen-share" : "hidden-element"}
          autoPlay
          playsInline
          ref={userScreenShare}
        />
        <div className="video">
          <span className="username">You - {userName}</span>
          <video autoPlay playsInline ref={userScreenShare} />
        </div>
        {remoteScreens?.map((remoteScreen, i) => (
          <Video stream={remoteScreen} key={i} index={i} />
        ))}
      </div> */}

      <div className="buttons-wrapper">
        <button
          onClick={toggleVideo}
          className={
            videoEnabled ? "button button-cam-off" : "button button-cam-on"
          }
        >
          {videoEnabled ? "Turn off cam" : "Turn on cam"}
        </button>
        <button
          onClick={toggleAudio}
          className={
            audioEnabled ? "button button-cam-off" : "button button-cam-on"
          }
        >
          {audioEnabled ? "Turn off mic" : "Turn on mic"}
        </button>
        {isSharingScreen ? (
          <button
            onClick={stopSharingScreen}
            className="button button-share-stop"
          >
            Stop sharing screen
          </button>
        ) : (
          <button onClick={shareScreen} className="button button-share">
            Share screen
          </button>
        )}
        <button className="button button-create-new" onClick={createRoom}>
          Create New Room
        </button>
        <button className="button button-disconnect" onClick={leaveRoom}>
          Disconnect
        </button>

        <button className="button button-create-new">
          <a
            href={match.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ padding: "15px 45px" }}
          >
            Open new tab
          </a>
        </button>
      </div>

      <div id="messages-viewer">
        <div id="messages">
          {messages.map((msg, index) => (
            <div key={index}>
              {/* <label className={msg.yours ? "my-label" : "partner-label"}>
                {msg.yours ? "You" : partnerName}
              </label> */}
              <p className={msg.yours ? "my-msg" : "partner-msg"}>
                {msg.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="input-wrapper">
        <div className="form__group">
          <input
            type="text"
            className="form__input"
            id="name"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Say something..."
          />
        </div>
        <button
          type="button"
          onClick={sendMessage}
          className={
            dataChannelRef.current && text
              ? "button button-share"
              : "button button-share disabled"
          }
        >
          Send now
        </button>
      </div>
    </div>
  );
};

export default Room;

// async function handleOffer(incoming) {
//   console.log("handleOffer");

//   if (!peerRef.current) {
//     peerRef.current = createPeer(incoming.caller);

//     await userStream.current.getTracks().forEach((track) => {
//       peerRef.current.addTrack(track, userStream.current);
//     });
//   }

//   const desc = new RTCSessionDescription(incoming.sdp);
//   await peerRef.current.setRemoteDescription(desc);

//   const answer = await peerRef.current.createAnswer();
//   await peerRef.current.setLocalDescription(answer);

//   const payload = {
//     target: incoming.caller,
//     caller: socketRef.current.id,
//     name: "Offer creator",
//     sdp: peerRef.current.localDescription,
//   };
//   socketRef.current.emit("answer", payload);
// }
