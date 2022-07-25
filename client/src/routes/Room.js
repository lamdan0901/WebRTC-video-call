import React, { useRef, useEffect, useState } from "react";
import io from "socket.io-client";

//* webapp flow:
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
    {
      urls: "stun:stun.stunprotocol.org",
    },
    {
      urls: "turn:numb.viagenie.ca",
      credential: "muazkh",
      username: "webrtc@live.com",
    },
  ],
};

const Room = ({ match }) => {
  // const [currentUserVideo, setCurrentUserVideo] = useState();
  const [userName, setUserName] = useState("");
  const [partnerName, setPartnerName] = useState("");

  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [isSharingScreen, setIsSharingScreen] = useState(true);

  const [text, setText] = useState("");
  const [messages, setMessages] = useState([]);

  const userVideo = useRef();
  const userStream = useRef();
  const userScreenShare = useRef();

  const partnerVideo = useRef();
  const partnerUserID = useRef();
  const partnerScreenShare = useRef();

  const peerRef = useRef();
  // const peerRef2 = useRef();
  const socketRef = useRef();
  const dataChannelRef = useRef();
  const senders = useRef([]);

  const screenTrack = useRef();
  const stream2 = useRef();

  useEffect(() => {
    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      userVideo.current.srcObject = stream;
      userStream.current = stream;

      navigator.mediaDevices
        .getDisplayMedia({
          cursor: true,
        })
        .then((stream) => {
          screenTrack.current = stream.getTracks()[0];
          userScreenShare.current.srcObject = stream;
          stream2.current = stream;
          setIsSharingScreen(true);

          socketRef.current = io.connect("/");
          socketRef.current.emit("join room", match.params.roomID);

          socketRef.current.on("other user joined", (userID) => {
            peerRef.current = createPeer(userID);

            peerRef.current.addTrack(
              screenTrack.current,
              userStream.current,
              stream2.current
            );

            createDataChannel();

            userStream.current.getTracks().forEach((track) => {
              peerRef.current.addTrack(track, userStream.current);
            });

            partnerUserID.current = userID;
          });

          socketRef.current.on("new user joined", (userID) => {
            partnerUserID.current = userID;
          });

          socketRef.current.on("connect", () => {
            console.log("client connected");
          });

          socketRef.current.on("offer", handleOffer);

          socketRef.current.on("answer", handleAnswer);

          socketRef.current.on("ice-candidate", handleICECandidate);

          socketRef.current.on("user left", () => {
            partnerVideo.current.srcObject = null;
            setPartnerName("");
          });
        });
    });
    // eslint-disable-next-line
  }, []);

  function createPeer(userID) {
    const peer = new RTCPeerConnection(rtcConfig);

    peer.onnegotiationneeded = () => handleNegotiationNeeded(userID);

    peer.onicecandidate = (e) => {
      if (e.candidate) {
        const payload = {
          target: partnerUserID.current,
          candidate: e.candidate,
        };
        socketRef.current.emit("ice-candidate", payload);
      }
    };

    // listen for when our peers actually add their tracks too
    // `ontrack` receives a callback that is fired when an RTP packet is received from the remote peer
    peer.ontrack = (e) => {
      partnerVideo.current.srcObject = e.streams[0];
      console.log("e.streams.length: ", e.streams.length);
      if (e.streams[1]) {
        partnerScreenShare.current.srcObject = e.streams[1];
      }
      return false;
    };

    return peer;
  }

  function createDataChannel() {
    dataChannelRef.current = peerRef.current.createDataChannel("dataChannel");
    dataChannelRef.current.onmessage = handleReceiveMessage;
  }

  async function handleNegotiationNeeded(userID) {
    // `offer` is a session description of the local state to be shared with the remote peer.
    const offer = await peerRef.current.createOffer();
    await peerRef.current.setLocalDescription(offer);

    const payload = {
      target: userID,
      caller: socketRef.current.id,
      name: "Offer acceptor",
      sdp: peerRef.current.localDescription,
    };

    socketRef.current.emit("offer", payload);
    setUserName("Offer acceptor");
  }

  async function handleOffer(incoming) {
    if (!peerRef.current) {
      peerRef.current = createPeer(incoming.caller);
      setUserName("Offer creator");
      setPartnerName(incoming.name);

      peerRef.current.ondatachannel = (e) => {
        dataChannelRef.current = e.channel;
        dataChannelRef.current.onmessage = handleReceiveMessage;
      };

      const desc = new RTCSessionDescription(incoming.sdp);
      await peerRef.current.setRemoteDescription(desc);

      peerRef.current.addTrack(
        screenTrack.current,
        userStream.current,
        stream2.current
      );

      await userStream.current.getTracks().forEach((track) => {
        peerRef.current.addTrack(track, userStream.current);
      });

      const answer = await peerRef.current.createAnswer();
      await peerRef.current.setLocalDescription(answer);

      const payload = {
        target: incoming.caller,
        caller: socketRef.current.id,
        name: "Offer creator",
        sdp: peerRef.current.localDescription,
      };
      socketRef.current.emit("answer", payload);
    } else {
      const desc = new RTCSessionDescription(incoming.sdp);
      await peerRef.current.setRemoteDescription(desc);

      const answer = await peerRef.current.createAnswer();
      await peerRef.current.setLocalDescription(answer);

      const payload = {
        target: incoming.caller,
        caller: socketRef.current.id,
        name: "Offer creator",
        sdp: peerRef.current.localDescription,
      };
      socketRef.current.emit("answer", payload);
    }
  }

  function handleAnswer(message) {
    setPartnerName(message.name);
    const desc = new RTCSessionDescription(message.sdp);
    peerRef.current.setRemoteDescription(desc).catch((e) => console.log(e));
  }

  function handleICECandidate(icecandidate) {
    const candidate = new RTCIceCandidate(icecandidate);
    peerRef.current.addIceCandidate(candidate).catch((e) => console.log(e));
  }

  function handleReceiveMessage(e) {
    setMessages((messages) => [...messages, { yours: false, value: e.data }]);
  }

  function sendMessage() {
    dataChannelRef.current.send(text);
    setMessages((messages) => [...messages, { yours: true, value: text }]);
    setText("");
  }

  async function shareScreen() {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      cursor: true,
    });

    // peerRef.current.getSenders().forEach((sender) => {
    //   // sender.stop();
    //   peerRef.current.removeTrack(sender);
    // });

    const screenTrack = stream.getTracks()[0];

    // const videoTrack = senders.current.find(
    //   (sender) => sender.track.kind === "video"
    // );
    // if (!videoTrack) return;

    peerRef.current.addTrack(screenTrack, stream);

    // videoTrack.replaceTrack(screenTrack);
    setIsSharingScreen(true);

    // userVideo.current.srcObject = stream;
    userScreenShare.current.srcObject = stream;
    // userStream.current = stream;

    screenTrack.onended = function () {
      userScreenShare.current.srcObject
        .getTracks()
        .forEach((track) => track.stop());
      setIsSharingScreen(false);

      userScreenShare.current.srcObject = null;
      // userVideo.current.srcObject = currentUserVideo;
      // findAndReplaceVideoTrack();
    };
  }

  function stopSharingScreen() {
    // userVideo.current.srcObject
    userScreenShare.current.srcObject
      .getVideoTracks()
      .forEach((track) => track.stop());
    setIsSharingScreen(false);

    userScreenShare.current.srcObject = null;

    // userVideo.current.srcObject = currentUserVideo;
    // findAndReplaceVideoTrack();
  }

  // function findAndReplaceVideoTrack() {
  //   const videoTrack = senders.current.find(
  //     (sender) => sender.track.kind === "video"
  //   );
  //   if (videoTrack) {
  //     videoTrack.replaceTrack(currentUserVideo.getTracks()[1]);
  //     setIsSharingScreen(false);
  //   }
  // }

  function toggleAudio() {
    userVideo.current.srcObject.getAudioTracks()[0].enabled = !audioEnabled;
    setAudioEnabled(!audioEnabled);
  }

  function toggleVideo() {
    userVideo.current.srcObject.getVideoTracks()[0].enabled = !videoEnabled;
    setVideoEnabled(!videoEnabled);
  }

  window.addEventListener("beforeunload", () =>
    socketRef.current.emit("disconnect from socket")
  );

  return (
    <div className="container">
      <div className="video-wrapper">
        <div className="video">
          <span className="username">You - {userName}</span>
          <video autoPlay playsInline ref={userVideo} />
        </div>
        <div className="video">
          <span className="username">Partner - {partnerName}</span>
          <video autoPlay playsInline ref={partnerVideo} />
        </div>
      </div>

      <div className="video-wrapper">
        <video
          className="screen-share"
          autoPlay
          playsInline
          ref={userScreenShare}
        />
        <video
          className="screen-share"
          autoPlay
          playsInline
          ref={partnerScreenShare}
        />
      </div>

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
          senders.current && (
            <button onClick={shareScreen} className="button button-share">
              Share screen
            </button>
          )
        )}

        <button
          className="button button-disconnect"
          onClick={() => {
            socketRef.current.emit("disconnect from socket");
            window.location.href = "/";
          }}
        >
          Disconnect
        </button>
      </div>

      <div id="messages-viewer">
        <div id="messages">
          {messages.map((msg, index) => (
            <div key={index}>
              <label className={msg.yours ? "my-label" : "partner-label"}>
                {msg.yours ? "You" : partnerName}
              </label>
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
