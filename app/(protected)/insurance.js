// app/insurance.js  (or app/screens/insurance.js)
import * as WebBrowser from 'expo-web-browser';
import { getDownloadURL, getMetadata, listAll, ref } from 'firebase/storage';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { storage } from '../../firebaseConfig'; // <-- adjust path if placed in /screens/

function formatBytes(bytes = 0) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`;
}

export default function InsuranceScreen() {
  const [files, setFiles] = useState([]); // [{name, path, size, url}]
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const fetchFiles = useCallback(async () => {
    try {
      setError('');
      const folderRef = ref(storage, 'insurance'); // lists gs://<bucket>/insurance/*
      const res = await listAll(folderRef);

      // For each item, fetch metadata + URL
      const rows = await Promise.all(
        res.items.map(async (itemRef) => {
          const [meta, url] = await Promise.all([
            getMetadata(itemRef).catch(() => ({})),
            getDownloadURL(itemRef),
          ]);
          return {
            name: itemRef.name,
            path: itemRef.fullPath,
            size: meta?.size || 0,
            url,
            contentType: meta?.contentType || 'application/octet-stream',
            updated: meta?.updated || null,
          };
        })
      );

      // Sort by name asc (or updated desc if you prefer)
      rows.sort((a, b) => a.name.localeCompare(b.name));
      setFiles(rows);
    } catch (e) {
      console.warn('insurance list error:', e);
      setError('Could not load insurance documents.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchFiles();
    setRefreshing(false);
  }, [fetchFiles]);

  const openDoc = async (url) => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      console.warn('open error:', e);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 }}>
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>
          Insurance & Compliance
        </Text>
        <Text style={{ color: '#9e9e9e', marginTop: 4 }}>
          All policy and safety documents.
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#C8102E" />
          <Text style={{ color: '#9e9e9e', marginTop: 10 }}>Loading documents…</Text>
        </View>
      ) : error ? (
        <View style={{ padding: 16 }}>
          <Text style={{ color: '#f88' }}>{error}</Text>
          <TouchableOpacity
            onPress={fetchFiles}
            style={{
              marginTop: 10,
              backgroundColor: '#2E2E2E',
              paddingVertical: 10,
              borderRadius: 8,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : files.length === 0 ? (
        <View style={{ padding: 16 }}>
          <Text style={{ color: '#bdbdbd' }}>No insurance documents found.</Text>
        </View>
      ) : (
        <FlatList
          data={files}
          keyExtractor={(item) => item.path}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#fff"
            />
          }
          contentContainerStyle={{ padding: 12 }}
          renderItem={({ item }) => (
            <View
              style={{
                backgroundColor: '#1a1a1a',
                borderWidth: 1,
                borderColor: '#262626',
                borderRadius: 12,
                padding: 14,
                marginBottom: 10,
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>
                {item.name}
              </Text>
              <Text style={{ color: '#9e9e9e', marginTop: 4 }}>
                {item.contentType?.includes('pdf') ? 'PDF' : item.contentType} ·{' '}
                {formatBytes(item.size)}
                {item.updated ? ` · Updated ${new Date(item.updated).toLocaleDateString('en-GB')}` : ''}
              </Text>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity
                  onPress={() => openDoc(item.url)}
                  style={{
                    flex: 1,
                    backgroundColor: '#C8102E',
                    paddingVertical: 10,
                    borderRadius: 8,
                    alignItems: 'center',
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: '#fff', fontWeight: '800' }}>Open</Text>
                </TouchableOpacity>

                {/* If you want a second action later (e.g., Share), add here */}
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
