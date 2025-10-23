import * as ImageManipulator from "expo-image-manipulator";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { storage } from "../../../firebaseConfig";

/**
 * Resizes to JPEG, uploads with progress, returns { downloadURL, fullPath }.
 */
export async function uploadImage({
  uri,
  destPath,
  maxWidth = 1600,
  quality = 0.8,
  onProgress = () => {},
}) {
  if (!uri) throw new Error("uploadImage: uri required");
  if (!destPath) throw new Error("uploadImage: destPath required");

  // 1) Resize/convert on device
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: maxWidth } }],
    { compress: quality, format: ImageManipulator.SaveFormat.JPEG }
  );

  // 2) Turn file into Blob (Expo-safe)
  const res = await fetch(manipulated.uri);
  const blob = await res.blob();

  // 3) Upload with progress
  const fileRef = ref(storage, destPath);
  const task = uploadBytesResumable(fileRef, blob, { contentType: "image/jpeg" });

  const downloadURL = await new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      snap => onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      reject,
      async () => resolve(await getDownloadURL(task.snapshot.ref))
    );
  });

  return { downloadURL, fullPath: task.snapshot.ref.fullPath };
}

/** `recce-photos/<uid>/<YYYY-MM-DD>/<ts>-<i>.jpg` */
export function makePath(uid, i = 0) {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const date = `${yyyy}-${mm}-${dd}`;
  const ts = d.getTime();
  return `recce-photos/${uid}/${date}/${ts}-${i}.jpg`;
}
