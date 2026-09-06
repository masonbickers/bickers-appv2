import {
  AppModal,
  AppButton,
  AppText as Text,
  FormField,
  AppPressable as TouchableOpacity,
  MediaViewerModal,
} from "../../components/ui/AppPrimitives";
import {
  useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  } from "firebase/firestore";
import { deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable } from "firebase/storage";
import { useEffect,
  useMemo,
  useRef,
  useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  StyleSheet,
  View,
} from "react-native";

import Icon from "react-native-vector-icons/Feather";

import { db, storage } from "../../firebaseConfig";
import { resubmitReceipt, transitionReceiptGroup } from "../../lib/receiptApi";
import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider";
import { staticColors } from "../../lib/design/staticColors";
import { withAlpha } from "../../lib/design/color";
import { designTokens as t } from "../../lib/design/tokens";
import PageShell from "../../components/layout/PageShell";

const MAX_FILE_BYTES = 15 * 1024 * 1024;

function currentMonthKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
  }).format(date).slice(0, 7);
}

function shiftMonth(monthKey, amount) {
  const [year, month] = monthKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function previousStatementMonthKey() {
  return shiftMonth(currentMonthKey(), -1);
}

function monthLabel(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 15))
  );
}

function groupIdFor(companyId, uid, monthKey) {
  return [companyId, uid, monthKey].map((value) => encodeURIComponent(String(value || "").trim())).join("__");
}

function moneyToPence(value) {
  const amount = Number.parseFloat(String(value || "").replace(/,/g, ""));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function pounds(pence) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(pence || 0) / 100);
}

function statusLabel(status) {
  return {
    pending: "Awaiting review",
    checked: "Checked",
    queried: "Action required",
    vat_claimed: "VAT claimed",
    no_vat: "No VAT",
  }[status] || "Awaiting review";
}

function groupStatusLabel(status) {
  return {
    draft: "Draft",
    submitted: "Submitted",
    action_required: "Action required",
    closed: "Closed",
  }[status] || "Not started";
}

function groupStatusDescription(status, receiptCount) {
  if (status === "submitted") return "Sent to finance. You can still add another receipt if needed.";
  if (status === "action_required") return "Finance needs changes before this statement can be completed.";
  if (status === "closed") return "Finance has completed this statement.";
  if (status === "draft") {
    return receiptCount > 0
      ? "Add every receipt, then submit the statement to finance."
      : "Add receipt photos or declare that there were none.";
  }
  return "Add receipt photos for this company-card statement.";
}

function receiptDateLabel(value) {
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value || 0);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

async function prepareReceipt(uri) {
  const prepared = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1800 } }],
    { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
  );
  const response = await fetch(prepared.uri);
  const blob = await response.blob();
  if (blob.size > MAX_FILE_BYTES) throw new Error("The receipt photo must be smaller than 15 MB.");
  return { uri: prepared.uri, blob };
}

function isPdfAttachment(attachment) {
  const type = String(attachment?.mimeType || attachment?.fileType || "").toLowerCase();
  const name = String(attachment?.name || attachment?.fileName || "").toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf");
}

function attachmentName(attachment) {
  return String(attachment?.name || attachment?.fileName || (isPdfAttachment(attachment) ? "receipt.pdf" : "receipt.jpg"));
}

async function prepareAttachment(attachment) {
  if (!isPdfAttachment(attachment)) {
    const prepared = await prepareReceipt(attachment.uri);
    return { ...prepared, fileName: "receipt.jpg", fileType: "image/jpeg", extension: "jpg" };
  }

  const response = await fetch(attachment.uri);
  const blob = await response.blob();
  if (blob.size > MAX_FILE_BYTES) throw new Error("The receipt file must be smaller than 15 MB.");
  return {
    blob,
    fileName: attachmentName(attachment),
    fileType: "application/pdf",
    extension: "pdf",
  };
}

export default function ReceiptsPage() {
  const router = useRouter();
  const { colors } = useTheme();
  const { employee, user } = useAuth();
  const companyId = String(employee?.companyId || "bickers-action");
  const [monthKey, setMonthKey] = useState(previousStatementMonthKey);
  const [receipts, setReceipts] = useState([]);
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [purpose, setPurpose] = useState("");
  const [gross, setGross] = useState("");
  const [photo, setPhoto] = useState(null);
  const [savedPhotoUrl, setSavedPhotoUrl] = useState("");
  const [savedPhotoLoading, setSavedPhotoLoading] = useState(false);
  const [savedPhotoError, setSavedPhotoError] = useState(false);
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const mountedSubscriptions = useRef(0);
  const groupId = groupIdFor(companyId, user?.uid, monthKey);

  useEffect(() => {
    if (!user?.uid) {
      setReceipts([]);
      setGroup(null);
      const sessionError = new Error("Your session could not be verified.");
      sessionError.code = "auth/session-missing";
      setLoadError(sessionError);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setLoadError(null);
    mountedSubscriptions.current = 0;
    const constraints = [
      where("companyId", "==", companyId),
      where("monthKey", "==", monthKey),
      where("submitterUid", "==", user.uid),
    ];
    const settled = () => {
      mountedSubscriptions.current += 1;
      if (mountedSubscriptions.current >= 2) setLoading(false);
    };
    const stopReceipts = onSnapshot(query(collection(db, "receipts"), ...constraints), (snapshot) => {
      setReceipts(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0)));
      settled();
    }, (error) => {
      console.warn("Could not load receipts", error?.message || error);
      setLoadError(error);
      settled();
    });
    const stopGroup = onSnapshot(query(collection(db, "receiptGroups"), ...constraints), (snapshot) => {
      setGroup(snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() });
      settled();
    }, (error) => {
      console.warn("Could not load receipt statement", error?.message || error);
      setLoadError(error);
      settled();
    });
    return () => {
      stopReceipts();
      stopGroup();
    };
  }, [companyId, monthKey, reloadKey, user?.uid]);

  const totals = useMemo(() => receipts.reduce((summary, item) => ({
    grossPence: summary.grossPence + Number(item.valuePence || 0),
    queried: summary.queried + (item.status === "queried" ? 1 : 0),
  }), { grossPence: 0, queried: 0 }), [receipts]);

  const canAdd = !loading && !loadError && (!group || ["draft", "submitted"].includes(group.status));
  const attachmentIsPdf = photo ? isPdfAttachment(photo) : isPdfAttachment(editing);
  const displayedPhotoUrl = attachmentIsPdf ? "" : photo?.uri || savedPhotoUrl;
  const displayedFileUrl = attachmentIsPdf ? photo?.uri || savedPhotoUrl : "";
  const editorCanEdit = !editing || group?.status === "draft" || editing.status === "queried";
  const statementStatus = groupStatusLabel(group?.status);
  const statementStatusColor = group?.status === "action_required"
    ? colors.danger
    : group?.status === "closed"
      ? colors.success
      : group?.status === "submitted"
        ? colors.warning
        : colors.accent;
  const statementDescription = groupStatusDescription(group?.status, receipts.length);
  const retryReceipts = () => {
    setLoading(true);
    setReloadKey((value) => value + 1);
  };

  useEffect(() => {
    let active = true;
    const storagePath = editing?.storagePath;

    setSavedPhotoUrl("");
    setSavedPhotoError(false);
    if (!editorOpen || !storagePath) {
      setSavedPhotoLoading(false);
      return () => {
        active = false;
      };
    }

    setSavedPhotoLoading(true);
    getDownloadURL(ref(storage, storagePath))
      .then((url) => {
        if (active) setSavedPhotoUrl(url);
      })
      .catch((error) => {
        console.warn("Could not load receipt photo", error?.message || error);
        if (active) setSavedPhotoError(true);
      })
      .finally(() => {
        if (active) setSavedPhotoLoading(false);
      });

    return () => {
      active = false;
    };
  }, [editing?.storagePath, editorOpen]);

  const resetEditor = () => {
    setEditorOpen(false);
    setPhotoViewerOpen(false);
    setEditing(null);
    setPurpose("");
    setGross("");
    setPhoto(null);
    setSavedPhotoUrl("");
    setSavedPhotoLoading(false);
    setSavedPhotoError(false);
    setProgress(0);
  };

  const beginAdd = () => {
    setEditing(null);
    setPurpose("");
    setGross("");
    setPhoto(null);
    setEditorOpen(true);
  };

  const beginEdit = (receipt) => {
    setEditing(receipt);
    setPurpose(receipt.purpose || "");
    setGross((Number(receipt.valuePence || 0) / 100).toFixed(2));
    setPhoto(null);
    setEditorOpen(true);
  };

  const choosePhoto = async (camera = false) => {
    const permission = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : Platform.OS === "web"
      ? { status: "granted" }
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert("Permission required", `Allow ${camera ? "camera" : "photo"} access to attach a receipt.`);
      return;
    }
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, cameraType: ImagePicker.CameraType.back, quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: false, quality: 0.9 });
    if (!result.canceled && result.assets?.[0]?.uri) setPhoto(result.assets[0]);
  };

  const chooseFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/*"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const attachment = result.assets[0];
    if (Number(attachment.size || 0) > MAX_FILE_BYTES) {
      Alert.alert("File too large", "Choose a receipt file smaller than 15 MB.");
      return;
    }
    setPhoto(attachment);
  };

  const uploadPhoto = async (receiptId) => {
    if (!photo?.uri) return null;
    const prepared = await prepareAttachment(photo);
    const storagePath = `companies/${companyId}/receipts/${user.uid}/${receiptId}/${Date.now()}-receipt.${prepared.extension}`;
    const target = ref(storage, storagePath);
    await new Promise((resolve, reject) => {
      const task = uploadBytesResumable(target, prepared.blob, { contentType: prepared.fileType });
      task.on("state_changed", (snapshot) => setProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)), reject, resolve);
    });
    return {
      target,
      storagePath,
      fileName: prepared.fileName,
      fileType: prepared.fileType,
      fileSize: prepared.blob.size,
    };
  };

  const saveReceipt = async () => {
    const valuePence = moneyToPence(gross);
    if (!purpose.trim()) return Alert.alert("Purpose required", "Tell finance what the receipt is for.");
    if (valuePence <= 0) return Alert.alert("Value required", "Enter the gross amount paid.");
    if (!editing && !photo) return Alert.alert("Receipt required", "Take a photo, choose a photo, or select a file.");
    setSaving(true);
    let uploaded = null;
    let reopenedSubmittedStatement = false;
    let receiptSaved = false;
    try {
      if (!editing && group?.status === "submitted") {
        await transitionReceiptGroup(user, groupId, {
          action: "reopen",
          companyId,
          monthKey,
          submitterName: employee?.displayName || user?.displayName || user?.email || "User",
        });
        reopenedSubmittedStatement = true;
      }
      const receiptRef = editing ? doc(db, "receipts", editing.id) : doc(collection(db, "receipts"));
      uploaded = await uploadPhoto(receiptRef.id);
      const filePatch = uploaded ? {
        storagePath: uploaded.storagePath,
        fileName: uploaded.fileName,
        fileType: uploaded.fileType,
        fileSize: uploaded.fileSize,
      } : {};
      if (editing?.status === "queried") {
        await resubmitReceipt(user, editing.id, { purpose: purpose.trim(), valuePence, ...filePatch });
      } else if (editing) {
        await updateDoc(receiptRef, {
          purpose: purpose.trim(),
          valuePence,
          suggestedVatPence: Math.round(valuePence / 6),
          ...filePatch,
          updatedAt: serverTimestamp(),
        });
      } else {
        const batch = writeBatch(db);
        if (!group) {
          batch.set(doc(db, "receiptGroups", groupId), {
            companyId,
            submitterUid: user.uid,
            submitterName: employee?.displayName || user.displayName || user.email || "User",
            monthKey,
            status: "draft",
            declaredNoReceipts: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        batch.set(receiptRef, {
          companyId,
          submitterUid: user.uid,
          submitterName: employee?.displayName || user.displayName || user.email || "User",
          submitterEmail: employee?.email || user.email || "",
          monthKey,
          groupId,
          purpose: purpose.trim(),
          valuePence,
          suggestedVatPence: Math.round(valuePence / 6),
          vatPence: 0,
          ...filePatch,
          status: "pending",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
        receiptSaved = true;
      }
      if (reopenedSubmittedStatement) {
        await transitionReceiptGroup(user, groupId, {
          action: "submit",
          companyId,
          monthKey,
          submitterName: employee?.displayName || user?.displayName || user?.email || "User",
        });
      }
      if (uploaded && editing?.storagePath && editing.storagePath !== uploaded.storagePath) {
        deleteObject(ref(storage, editing.storagePath)).catch(() => {});
      }
      resetEditor();
      if (reopenedSubmittedStatement) {
        Alert.alert("Statement updated", "The new receipt was added and the updated statement was sent to finance.");
      }
    } catch (error) {
      if (uploaded && !editing && !receiptSaved) deleteObject(uploaded.target).catch(() => {});
      if (receiptSaved) {
        resetEditor();
        Alert.alert(
          "Receipt saved",
          "The receipt was added, but the updated statement could not be sent. Tap Submit statement to try again."
        );
      } else {
        Alert.alert("Receipt not saved", error?.message || "Please try again.");
      }
    } finally {
      setSaving(false);
      setProgress(0);
    }
  };

  const removeReceipt = (receipt) => {
    Alert.alert("Delete receipt?", receipt.purpose || receipt.fileName, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await deleteDoc(doc(db, "receipts", receipt.id));
          if (receipt.storagePath) deleteObject(ref(storage, receipt.storagePath)).catch(() => {});
        } catch (error) {
          Alert.alert("Delete failed", error?.message || "Please try again.");
        }
      } },
    ]);
  };

  const submitStatement = async (action) => {
    try {
      await transitionReceiptGroup(user, groupId, {
        action,
        companyId,
        monthKey,
        submitterName: employee?.displayName || user?.displayName || user?.email || "User",
      });
      Alert.alert("Sent to finance", action === "declare_none" ? "This statement was declared empty." : "Your receipts are ready for finance to review.");
    } catch (error) {
      Alert.alert("Statement not submitted", error?.message || "Please try again.");
    }
  };

  return (
    <PageShell
      contentSpacing="compact"
      header={{
        variant: "compact",
        eyebrow: "Finance",
        title: "Receipts",
        subtitle: "Monthly company-card statements",
        onBack: router.back,
        action: canAdd ? { label: "Add", icon: "plus", onPress: beginAdd } : undefined,
      }}
      state={{
        resources: [{
          data: receipts,
          error: loadError,
          isInitialLoading: loading,
          isRefreshing: false,
        }],
        hasContent: receipts.length > 0 || !!group,
        onRetry: retryReceipts,
        loadingLabel: "Loading statement…",
        errorTitle: "Receipts unavailable",
        errorMessage: "Your statement could not be loaded. Check your access or connection and retry.",
        refreshErrorMessage: "Could not refresh the full statement. Showing available receipts.",
      }}
    >

      <>
        <View style={styles.monthRow}>
          <TouchableOpacity style={[styles.monthButton, { borderColor: colors.border }]} onPress={() => setMonthKey((value) => shiftMonth(value, -1))} accessibilityLabel="Previous statement month"><Icon name="chevron-left" size={20} color={colors.text} /></TouchableOpacity>
          <View style={styles.monthCopy}><Text style={[styles.monthTitle, { color: colors.text }]}>{monthLabel(monthKey)}</Text><Text style={[styles.monthSubtitle, { color: colors.textMuted }]}>Statement month</Text></View>
          <TouchableOpacity disabled={monthKey >= currentMonthKey()} style={[styles.monthButton, { borderColor: colors.border, opacity: monthKey >= currentMonthKey() ? 0.35 : 1 }]} onPress={() => setMonthKey((value) => shiftMonth(value, 1))} accessibilityLabel="Next statement month"><Icon name="chevron-right" size={20} color={colors.text} /></TouchableOpacity>
        </View>

        <View style={[styles.statementSummary, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}> 
          <View style={styles.statementSummaryTop}>
            <View
              style={[
                styles.statusPill,
                {
                  borderColor: statementStatusColor,
                  backgroundColor: withAlpha(statementStatusColor, 0.14),
                },
              ]}
            >
              <View style={[styles.statusDot, { backgroundColor: statementStatusColor }]} />
              <Text style={[styles.statusPillText, { color: statementStatusColor }]}>{statementStatus}</Text>
            </View>
            <Text style={[styles.receiptCount, { color: colors.textMuted }]}> 
              {receipts.length} {receipts.length === 1 ? "receipt" : "receipts"}
            </Text>
          </View>
          <View style={styles.statementSummaryBody}>
            <Text style={[styles.statementTotal, { color: colors.text }]}>{pounds(totals.grossPence)}</Text>
            <Text style={[styles.statementDescription, { color: colors.textMuted }]}>{statementDescription}</Text>
          </View>
        </View>

        {group?.status === "action_required" ? <View style={[styles.queryBanner, { borderColor: colors.danger, backgroundColor: colors.surfaceAlt }]}><Icon name="alert-circle" size={18} color={colors.danger} /><View style={styles.queryCopy}><Text style={[styles.queryTitle, { color: colors.danger }]}>Finance needs a correction</Text><Text style={[styles.queryText, { color: colors.textMuted }]}>Tap the queried receipt, make the change and resubmit it.</Text></View></View> : null}

        {receipts.length === 0 ? (
          <View style={[styles.empty, { borderColor: colors.border }]}><Icon name="file-text" size={28} color={colors.textMuted} /><Text style={[styles.emptyTitle, { color: colors.text }]}>No receipts for this statement</Text><Text style={[styles.emptyText, { color: colors.textMuted }]}>Add a receipt photo or declare that you have none.</Text></View>
        ) : (
          <View style={styles.receiptList}>
            <View style={styles.receiptListHeader}>
              <Text style={[styles.receiptListTitle, { color: colors.text }]}>Receipts</Text>
              {totals.queried > 0 ? (
                <Text style={[styles.queriedCount, { color: colors.danger }]}>{totals.queried} needs action</Text>
              ) : null}
            </View>
            {receipts.map((receipt) => {
              const receiptDate = receiptDateLabel(receipt.createdAt || receipt.updatedAt);
              return (
                <TouchableOpacity key={receipt.id} activeOpacity={0.75} onPress={() => beginEdit(receipt)} accessibilityRole="button" accessibilityLabel={`View ${receipt.purpose} receipt`} style={[styles.receiptCard, { backgroundColor: colors.surfaceAlt, borderColor: receipt.status === "queried" ? colors.danger : colors.border }]}> 
                  <View style={[styles.receiptIcon, { backgroundColor: colors.accentSoft }]}><Icon name="file-text" size={20} color={colors.accent} /></View>
                  <View style={styles.receiptCopy}>
                    <View style={styles.receiptHeadline}>
                      <Text numberOfLines={2} style={[styles.receiptTitle, { color: colors.text }]}>{receipt.purpose}</Text>
                      <Text style={[styles.amount, { color: colors.text }]}>{pounds(receipt.valuePence)}</Text>
                    </View>
                    <Text style={[styles.receiptMeta, { color: receipt.status === "queried" ? colors.danger : colors.textMuted }]}> 
                      {[statusLabel(receipt.status), receiptDate].filter(Boolean).join(" · ")}
                    </Text>
                    {receipt.status === "queried" && receipt.queryNote ? <Text style={[styles.queryNote, { color: colors.text }]}>{receipt.queryNote}</Text> : null}
                  </View>
                  <View style={styles.receiptAction}>
                    {group?.status === "draft" ? (
                      <TouchableOpacity onPress={(event) => { event.stopPropagation?.(); removeReceipt(receipt); }} hitSlop={10} accessibilityLabel={`Delete ${receipt.purpose}`}><Icon name="trash-2" size={16} color={colors.danger} /></TouchableOpacity>
                    ) : (
                      <Icon name="chevron-right" size={18} color={colors.textMuted} />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {canAdd ? <View style={styles.statementActions}>{receipts.length ? <TouchableOpacity style={[styles.primaryAction, { backgroundColor: colors.accent }]} onPress={() => submitStatement("submit")}><Icon name="send" size={17} color={staticColors.hex_fff_yhjmu8} /><Text style={styles.primaryActionText}>Submit statement</Text></TouchableOpacity> : <TouchableOpacity style={[styles.secondaryAction, { borderColor: colors.border }]} onPress={() => submitStatement("declare_none")}><Text style={[styles.secondaryActionText, { color: colors.text }]}>Declare no receipts</Text></TouchableOpacity>}</View> : null}
      </>

      <AppModal
        visible={editorOpen}
        title={editing ? editorCanEdit ? "Update receipt" : "Receipt details" : "Add receipt"}
        onRequestClose={resetEditor}
        scrollable
        busy={saving}
      >
          <Text tone="secondary">{monthLabel(monthKey)} statement</Text>
          {editing?.status === "queried" && editing.queryNote ? <View style={[styles.editorQuery, { borderColor: colors.danger }]}><Text style={[styles.editorQueryLabel, { color: colors.danger }]}>FINANCE NOTE</Text><Text style={[styles.editorQueryText, { color: colors.text }]}>{editing.queryNote}</Text></View> : null}
          <FormField label="WHAT IS IT FOR?" value={purpose} onChangeText={setPurpose} disabled={!editorCanEdit} placeholder="e.g. Fuel for job 2451" maxLength={160} />
          <FormField label="GROSS VALUE (£)" value={gross} onChangeText={setGross} disabled={!editorCanEdit} placeholder="0.00" inputProps={{ keyboardType: "decimal-pad" }} />
          <Text style={[styles.label, { color: colors.textMuted }]}>RECEIPT ATTACHMENT</Text>
          {savedPhotoLoading && !photo?.uri ? <View style={[styles.photoLoading, { borderColor: colors.border }]}><ActivityIndicator color={colors.accent} /><Text style={[styles.photoStatusText, { color: colors.textMuted }]}>Loading submitted attachment…</Text></View> : null}
          {displayedPhotoUrl ? <TouchableOpacity activeOpacity={0.82} onPress={() => setPhotoViewerOpen(true)} accessibilityRole="button" accessibilityLabel="View receipt photo full screen"><Image source={{ uri: displayedPhotoUrl }} resizeMode="cover" style={[styles.preview, { borderColor: colors.border }]} /><View style={styles.previewBadge}><Icon name="maximize-2" size={14} color={staticColors.hex_fff_yhjmu8} /><Text style={styles.previewBadgeText}>View photo</Text></View></TouchableOpacity> : null}
          {displayedFileUrl ? <TouchableOpacity style={[styles.filePreview, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]} onPress={() => savedPhotoUrl && router.push({ pathname: "/document-viewer", params: { url: savedPhotoUrl, name: attachmentName(photo || editing), contentType: "application/pdf" } })} disabled={!savedPhotoUrl}><Icon name="file-text" size={20} color={colors.accent} /><View style={styles.filePreviewCopy}><Text numberOfLines={1} style={[styles.photoButtonText, { color: colors.text }]}>{attachmentName(photo || editing)}</Text><Text variant="caption" tone="secondary">PDF receipt{savedPhotoUrl ? " · Tap to view" : " selected"}</Text></View></TouchableOpacity> : null}
          {savedPhotoError && !photo?.uri ? <View style={[styles.photoError, { borderColor: colors.danger }]}><Icon name="alert-circle" size={17} color={colors.danger} /><Text style={[styles.photoStatusText, { color: colors.text }]}>The submitted attachment could not be loaded.</Text></View> : null}
          {editing && !editing.storagePath && !photo?.uri ? <View style={[styles.photoError, { borderColor: colors.border }]}><Icon name="paperclip" size={17} color={colors.textMuted} /><Text style={[styles.photoStatusText, { color: colors.textMuted }]}>No attachment is saved with this receipt.</Text></View> : null}
          {editorCanEdit ? <><Text style={[styles.label, { color: colors.textMuted }]}>{editing ? "REPLACE ATTACHMENT (OPTIONAL)" : "ADD ATTACHMENT"}</Text>
          <View style={styles.photoActions}><TouchableOpacity style={[styles.photoButton, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]} onPress={() => choosePhoto(true)} disabled={saving}><Icon name="camera" size={18} color={colors.text} /><Text style={[styles.photoButtonText, { color: colors.text }]}>Take photo</Text></TouchableOpacity><TouchableOpacity style={[styles.photoButton, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]} onPress={() => choosePhoto(false)} disabled={saving}><Icon name="image" size={18} color={colors.text} /><Text style={[styles.photoButtonText, { color: colors.text }]}>Choose photo</Text></TouchableOpacity><TouchableOpacity style={[styles.photoButton, styles.fileButton, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]} onPress={chooseFile} disabled={saving}><Icon name="file-plus" size={18} color={colors.text} /><Text style={[styles.photoButtonText, { color: colors.text }]}>Choose file</Text></TouchableOpacity></View>
          <AppButton label={saving ? `Uploading ${progress}%` : editing?.status === "queried" ? "Resubmit receipt" : editing ? "Save changes" : "Add receipt"} onPress={saveReceipt} loading={saving} disabled={saving} fullWidth /></> : <AppButton label="Done" variant="secondary" onPress={resetEditor} fullWidth />}
      </AppModal>

      <MediaViewerModal
        visible={photoViewerOpen && !!displayedPhotoUrl}
        uri={displayedPhotoUrl}
        accessibilityLabel="Receipt photo"
        onRequestClose={() => setPhotoViewerOpen(false)}
      />
    </PageShell>
  );
}

const styles = StyleSheet.create({
  monthRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: t.spacing.sm },
  monthButton: { width: 42, height: 42, borderWidth: 1, borderRadius: t.radius.lg, alignItems: "center", justifyContent: "center" },
  monthCopy: { flex: 1, alignItems: "center" }, monthTitle: { fontSize: t.typography.titleSmall.fontSize, fontWeight: "900" }, monthSubtitle: { fontSize: t.typography.caption.fontSize, marginTop: t.spacing.none },
  statementSummary: { borderWidth: 1, borderRadius: t.radius.lg, padding: t.spacing.sm },
  statementSummaryTop: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: t.spacing.xs },
  statementSummaryBody: { marginTop: t.spacing.sm, gap: t.spacing.xxs },
  statusPill: { minHeight: 28, borderWidth: 1, borderRadius: t.radius.pill, paddingHorizontal: t.spacing.xs, flexDirection: "row", alignItems: "center", gap: t.spacing.xxs },
  statusDot: { width: 7, height: 7, borderRadius: t.radius.pill },
  statusPillText: { fontSize: t.typography.caption.fontSize, fontWeight: "900" },
  receiptCount: { fontSize: t.typography.metadata.fontSize, fontWeight: "800" },
  statementTotal: { fontSize: t.typography.pageTitle.fontSize, lineHeight: t.typography.pageTitle.lineHeight, fontWeight: "900" },
  statementDescription: { fontSize: t.typography.metadata.fontSize, lineHeight: t.typography.metadata.lineHeight },
  queryBanner: { borderWidth: 1, borderRadius: t.radius.lg, padding: t.spacing.sm, flexDirection: "row", gap: t.spacing.xs }, queryCopy: { flex: 1 }, queryTitle: { fontSize: t.typography.body.fontSize, fontWeight: "900" }, queryText: { fontSize: t.typography.metadata.fontSize, marginTop: t.spacing.xxs, lineHeight: t.typography.metadata.lineHeight },
  empty: { minHeight: 160, borderWidth: 1, borderRadius: t.radius.xl, alignItems: "center", justifyContent: "center", padding: t.spacing.xl, gap: t.spacing.xs }, emptyTitle: { fontSize: t.typography.sectionTitle.fontSize, fontWeight: "900", textAlign: "center" }, emptyText: { fontSize: t.typography.bodySmall.fontSize, lineHeight: t.typography.bodySmall.lineHeight, textAlign: "center" },
  receiptList: { gap: t.spacing.xs },
  receiptListHeader: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  receiptListTitle: { fontSize: t.typography.sectionTitle.fontSize, fontWeight: "900" },
  queriedCount: { fontSize: t.typography.metadata.fontSize, fontWeight: "900" },
  receiptCard: { borderWidth: 1, borderRadius: t.radius.lg, padding: t.spacing.sm, flexDirection: "row", alignItems: "center", gap: t.spacing.sm }, receiptIcon: { width: 42, height: 42, borderRadius: t.radius.md, alignItems: "center", justifyContent: "center" }, receiptCopy: { flex: 1, minWidth: 0 }, receiptHeadline: { flexDirection: "row", alignItems: "flex-start", gap: t.spacing.xs }, receiptTitle: { flex: 1, minWidth: 0, fontSize: t.typography.bodyLarge.fontSize, lineHeight: t.typography.bodyLarge.lineHeight, fontWeight: "900" }, receiptMeta: { fontSize: t.typography.caption.fontSize, fontWeight: "800", marginTop: t.spacing.xxs }, queryNote: { fontSize: t.typography.metadata.fontSize, lineHeight: t.typography.metadata.lineHeight, marginTop: t.spacing.xs }, receiptAction: { width: 20, minHeight: 42, alignItems: "center", justifyContent: "center" }, amount: { flexShrink: 0, fontSize: t.typography.bodyLarge.fontSize, lineHeight: t.typography.bodyLarge.lineHeight, fontWeight: "900" },
  statementActions: { marginTop: t.spacing.xxs }, primaryAction: { minHeight: 50, borderRadius: t.radius.lg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: t.spacing.xs }, primaryActionText: { color: staticColors.hex_fff_yhjmu8, fontSize: t.typography.bodyLarge.fontSize, fontWeight: "900" }, secondaryAction: { minHeight: 48, borderWidth: 1, borderRadius: t.radius.lg, alignItems: "center", justifyContent: "center" }, secondaryActionText: { fontSize: t.typography.body.fontSize, fontWeight: "900" },
  overlay: { flex: 1, backgroundColor: staticColors.rgba_18a7u8j, alignItems: "center", justifyContent: "center", padding: t.spacing.sm }, modal: { width: "100%", maxWidth: 620, maxHeight: "94%", borderWidth: 1, borderRadius: t.radius.xl }, modalContent: { padding: t.spacing.md }, modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: t.spacing.xxs }, modalTitle: { fontSize: t.typography.titleSmall.fontSize, fontWeight: "900" }, modalSubtitle: { fontSize: t.typography.metadata.fontSize, marginTop: t.spacing.none }, close: { width: 38, height: 38, borderWidth: 1, borderRadius: t.radius.pill, alignItems: "center", justifyContent: "center" },
  editorQuery: { borderWidth: 1, borderRadius: t.radius.lg, padding: t.spacing.sm, marginTop: t.spacing.xs }, editorQueryLabel: { fontSize: t.typography.micro.fontSize, fontWeight: "900", letterSpacing: 0.7 }, editorQueryText: { fontSize: t.typography.bodySmall.fontSize, lineHeight: t.typography.bodySmall.lineHeight, marginTop: t.spacing.xxs }, label: { fontSize: t.typography.micro.fontSize, fontWeight: "900", letterSpacing: 0.7, marginTop: t.spacing.sm, marginBottom: t.spacing.xxs }, input: { minHeight: 48, borderWidth: 1, borderRadius: t.radius.lg, paddingHorizontal: t.spacing.sm, fontSize: t.typography.bodyLarge.fontSize }, preview: { width: "100%", height: 190, borderWidth: 1, borderRadius: t.radius.lg }, previewBadge: { position: "absolute", right: 10, bottom: 10, minHeight: 32, borderRadius: t.radius.pill, paddingHorizontal: t.spacing.sm, flexDirection: "row", alignItems: "center", gap: t.spacing.xxs, backgroundColor: staticColors.rgba_18a7uad }, previewBadgeText: { color: staticColors.hex_fff_yhjmu8, fontSize: t.typography.caption.fontSize, fontWeight: "900" }, photoLoading: { height: 120, borderWidth: 1, borderRadius: t.radius.lg, alignItems: "center", justifyContent: "center", gap: t.spacing.xs }, photoError: { minHeight: 52, borderWidth: 1, borderRadius: t.radius.lg, paddingHorizontal: t.spacing.sm, flexDirection: "row", alignItems: "center", gap: t.spacing.xs }, photoStatusText: { fontSize: t.typography.metadata.fontSize, fontWeight: "700" }, photoActions: { flexDirection: "row", flexWrap: "wrap", gap: t.spacing.xs }, photoButton: { flex: 1, minWidth: 130, minHeight: 48, borderWidth: 1, borderRadius: t.radius.lg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: t.spacing.xs }, fileButton: { flexBasis: "100%" }, filePreview: { minHeight: 58, borderWidth: 1, borderRadius: t.radius.lg, paddingHorizontal: t.spacing.sm, flexDirection: "row", alignItems: "center", gap: t.spacing.xs }, filePreviewCopy: { flex: 1, minWidth: 0 }, photoButtonText: { fontSize: t.typography.metadata.fontSize, fontWeight: "900" }, save: { minHeight: 50, borderRadius: t.radius.lg, alignItems: "center", justifyContent: "center", marginTop: t.spacing.sm }, saveText: { color: staticColors.hex_fff_yhjmu8, fontSize: t.typography.bodyLarge.fontSize, fontWeight: "900" }, done: { minHeight: 48, borderWidth: 1, borderRadius: t.radius.lg, alignItems: "center", justifyContent: "center", marginTop: t.spacing.sm }, doneText: { fontSize: t.typography.body.fontSize, fontWeight: "900" },
  viewerOverlay: { flex: 1, backgroundColor: staticColors.rgba_18a7iqn, alignItems: "center", justifyContent: "center" }, viewerClose: { position: "absolute", top: 12, right: 16, zIndex: 2, width: 46, height: 46, borderRadius: t.radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: staticColors.rgba_5ns6nr }, viewerImage: { width: "100%", height: "100%" },
});
