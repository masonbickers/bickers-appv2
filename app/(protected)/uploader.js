import { AppText as Text, AppPressable as TouchableOpacity } from "../../components/ui/AppPrimitives";
// app/uploader.js
import {
  useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  StyleSheet,
  View,
} from "react-native";


import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import {
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from 'firebase/storage';
import { auth, storage } from '../../firebaseConfig';
import { staticColors } from "../../lib/design/staticColors";
import { designTokens as t } from "../../lib/design/tokens";
import PageShell from "../../components/layout/PageShell";

const IMAGES_ONLY = ImagePicker.MediaTypeOptions.Images;

const THUMB = 92;

export default function Uploader() {
  // items: [{ uri: string }]
  const [items, setItems] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [urls, setUrls] = useState([]);

  const ensureMediaPerms = async () => {
    if (Platform.OS === 'web') return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') throw new Error('Permission to access photos is required.');
  };

  const pickFromLibrary = async () => {
    try {
      await ensureMediaPerms();
      const res = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,       // ignored if not supported
        selectionLimit: 8,
        mediaTypes: IMAGES_ONLY,
        quality: 1,
        // IMPORTANT: no base64
      });
      if (res?.canceled) return;

      const assets = Array.isArray(res?.assets) ? res.assets : [];
      const next = assets
        .filter(a => a && typeof a.uri === 'string' && a.uri.length > 0)
        .map(a => ({ uri: a.uri }));

      if (!next.length) return;
      setItems(prev => {
        const merged = [...(Array.isArray(prev) ? prev : []), ...next].slice(0, 16);
        return merged.filter(v => v && typeof v.uri === 'string' && v.uri.length > 0);
      });
    } catch (e) {
      console.warn(e);
      Alert.alert('Error', e?.message || 'Could not open library.');
    }
  };

  // Always materialize to a real file:// via ImageManipulator (fixes iOS ph://)
  const ensureFileUri = async (uri) => {
    if (!uri || typeof uri !== 'string') return null;
    try {
      const manip = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG } // returns a new file:// URI
      );
      return manip?.uri || null;
    } catch (e) {
      console.warn('ensureFileUri error:', e);
      return null;
    }
  };

  // Upload via Blob only (no ArrayBuffer, no base64 anywhere)
  const uploadFromUri = async (fileUri, storageRef) => {
    // Let RN produce a Blob from the file; do not use ArrayBuffer
    const resp = await fetch(fileUri);
    const blob = await resp.blob();

    await new Promise((resolve, reject) => {
      const task = uploadBytesResumable(storageRef, blob, { contentType: 'image/jpeg' });
      task.on('state_changed', undefined, reject, resolve);
    });
    return getDownloadURL(storageRef);
  };

  const uploadAll = async () => {
    if (!Array.isArray(items) || items.length === 0) {
      Alert.alert('No photos', 'Please add some photos first.');
      return;
    }
    if (uploading) return;

    setUploading(true);
    setProgressText('Starting…');
    setUrls([]);

    try {
      // Snapshot & validate to avoid mid-upload mutations
      const list = (Array.isArray(items) ? items : [])
        .filter((it, idx) => {
          const ok = it && typeof it.uri === 'string' && it.uri.length > 0;
          if (!ok) console.warn('Skipping invalid item at index', idx, it);
          return ok;
        });

      if (list.length === 0) {
        Alert.alert('No usable photos', 'Try picking or taking a photo again.');
        return;
      }

      const u = auth?.currentUser || null;
      const owner = (u && u.uid) || 'public';

      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');

      const out = [];
      for (let i = 0; i < list.length; i++) {
        setProgressText(`Processing ${i + 1} / ${list.length}`);

        const fileUri = await ensureFileUri(list[i].uri);
        if (!fileUri) {
          console.warn('Could not materialize file for item', i, list[i]);
          continue;
        }

        const filename = `${Date.now()}_${i}.jpg`;
        const path = `uploads/photos/${owner}/${yyyy}/${mm}/${filename}`;
        const r = ref(storage, path);

        const url = await uploadFromUri(fileUri, r);
        out.push(url);
        setProgressText(`Uploaded ${i + 1} / ${list.length}`);
      }

      setUrls(out);
      setProgressText(`Done — uploaded ${out.length} file(s).`);
    } catch (e) {
      console.warn(e);
      Alert.alert('Upload failed', e?.message || 'Unexpected error');
    } finally {
      setUploading(false);
    }
  };

  const removeAt = (idx) => {
    if (uploading) return; // prevent list mutation mid-upload
    setItems(prev => {
      if (!Array.isArray(prev)) return [];
      return prev.filter((_, i) => i !== idx);
    });
  };

  const clearAll  = () => {
    if (uploading) return;
    setItems([]); setUrls([]); setProgressText('');
  };

  return (
    <PageShell>
      <>
        {/* Header & actions */}
        <View style={styles.headerRow}>
          <Text style={styles.title}>Photo Uploader</Text>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.btn, styles.btnGhost, uploading && { opacity: 0.6 }]}
              onPress={pickFromLibrary}
              disabled={uploading}
            >
              <Text style={styles.btnText}>Library</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, uploading && { opacity: 0.7 }]}
              onPress={uploadAll}
              disabled={uploading}
            >
              <Text style={styles.btnText}>{uploading ? 'Uploading…' : 'Upload'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {!!progressText && <Text style={styles.progress}>{String(progressText)}</Text>}

        {/* Selected previews */}
        <View style={styles.grid}>
          {(!Array.isArray(items) || items.length === 0) ? (
            <Text style={styles.emptyHint}>No photos yet - use Library.</Text>
          ) : (
            items.map((it, idx) => (
              <View
                key={`${it?.uri || 'item'}-${idx}`}
                style={[styles.thumbWrap, (idx % 3 !== 2) && { marginRight: t.spacing.xs }]}
              >
                {it?.uri ? (
                  <Image source={{ uri: it.uri }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, { alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{ color: staticColors.hex_888_yhlrem, fontSize: t.typography.metadata.fontSize }}>No preview</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.remove, uploading && { opacity: 0.5 }]}
                  onPress={() => removeAt(idx)}
                  disabled={uploading}
                >
                  <Text style={styles.removeText}>×</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* Results */}
        {!!urls.length && (
          <View style={{ marginTop: t.spacing.md }}>
            <Text style={styles.sectionTitle}>Uploaded URLs</Text>
            {urls.map((u, i) => (
              <Text key={`${u}-${i}`} style={styles.url} numberOfLines={1}>
                {u}
              </Text>
            ))}

            <TouchableOpacity
              style={[styles.btn, styles.btnGhost, { marginTop: t.spacing.xs, alignSelf: 'flex-start' }]}
              onPress={clearAll}
              disabled={uploading}
            >
              <Text style={styles.btnText}>Clear</Text>
            </TouchableOpacity>
          </View>
        )}
      </>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: staticColors.hex_000_yhlkvq },
  content: { padding: t.spacing.md },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: t.spacing.sm,
  },
  title: { color: staticColors.hex_fff_yhjmu8, fontSize: t.typography.titleSmall.fontSize, fontWeight: '800' },

  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  btn: {
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.md,
    borderWidth: 1,
    alignItems: 'center',
    marginLeft: t.spacing.xs,
  },
  btnPrimary: { backgroundColor: staticColors.hex_c8102e_6za5cb, borderColor: staticColors.hex_a40e25_u1mmqp },
  btnGhost: { backgroundColor: staticColors.hex_141414_a6icwz, borderColor: staticColors.hex_232323_72yy4n },
  btnText: { color: staticColors.hex_fff_yhjmu8, fontWeight: '800' },

  progress: { color: staticColors.hex_cfcfcf_r9h9nn, marginBottom: t.spacing.xs },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  thumbWrap: {
    position: 'relative',
    width: THUMB,
    height: THUMB,
    borderRadius: t.radius.sm,
    backgroundColor: staticColors.hex_1a1a1a_98rvna,
    marginBottom: t.spacing.xs,
  },
  thumb: { width: THUMB, height: THUMB, borderRadius: t.radius.sm },
  remove: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: staticColors.hex_c8102e_6za5cb,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.xxs,
    paddingVertical: t.spacing.none,
    borderWidth: 1,
    borderColor: staticColors.hex_8e0b22_ezjn49,
  },
  removeText: { color: staticColors.hex_fff_yhjmu8, fontWeight: '900', fontSize: t.typography.body.fontSize },

  emptyHint: { color: staticColors.hex_8e8e8e_ezdnbv },

  sectionTitle: { color: staticColors.hex_fff_yhjmu8, fontWeight: '800', marginBottom: t.spacing.xxs, marginTop: t.spacing.xs },
  url: { color: staticColors.hex_9bd_yhlsqh, fontSize: t.typography.metadata.fontSize },
});
