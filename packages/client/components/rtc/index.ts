import { getVirtmic } from "./virtualMic";

export { useVoice, VoiceContext } from "./state";

export { InRoom } from "./components/InRoom";
export { RoomAudioManager } from "./components/RoomAudioManager";
export { stoatSinkName } from "./virtualMic";

const originalUserMedia = navigator.mediaDevices.getUserMedia.bind(
  navigator.mediaDevices,
);

/** Drop a pinned deviceId, which goes stale when a camera is unplugged. */
function withoutVideoDeviceId(constraints: MediaStreamConstraints) {
  const video = constraints.video;
  if (!video || typeof video !== "object" || video.deviceId == null)
    return null;

  const next = { ...video };
  delete next.deviceId;
  return {
    ...constraints,
    video: Object.keys(next).length ? next : true,
  } satisfies MediaStreamConstraints;
}

/** Give up on every video constraint but still get a picture. */
function withPlainVideo(constraints: MediaStreamConstraints) {
  if (!constraints.video || constraints.video === true) return null;
  return { ...constraints, video: true } satisfies MediaStreamConstraints;
}

// A saved camera can disappear or refuse the saved resolution, which otherwise
// fails the whole capture. Fall back progressively instead.
navigator.mediaDevices.getUserMedia = async function (constraints) {
  try {
    return await originalUserMedia(constraints);
  } catch (err) {
    if (!constraints) throw err;

    const withoutId = withoutVideoDeviceId(constraints);
    if (withoutId) {
      try {
        return await originalUserMedia(withoutId);
      } catch {
        /* fall through to unconstrained video */
      }
    }

    const plain = withPlainVideo(constraints);
    if (!plain) throw err;
    return originalUserMedia(plain);
  }
};

const originalMediaCall = navigator.mediaDevices.getDisplayMedia;

// Resolution and frame rate come from the quality the user picked in the screen
// share dialog; do not clamp them here or the picker becomes decorative.
navigator.mediaDevices.getDisplayMedia = async function (opts) {
  const stream: MediaStream = await originalMediaCall.call(this, opts);

  if (opts && opts.audio && window.native?.isWayland?.()) {
    const id = await getVirtmic();

    console.debug("Virt mic acquired:", id);

    if (id) {
      const audio = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: {
            exact: id,
          },
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
          channelCount: 2,
          sampleRate: 48000,
          sampleSize: 16,
        },
      });

      stream.getAudioTracks().forEach((t) => stream.removeTrack(t));
      stream.addTrack(audio.getAudioTracks()[0]);
    }
  }

  return stream;
};
