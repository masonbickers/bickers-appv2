import { AppModal, AppText as Text, AppPressable as TouchableOpacity, FormField, TextArea } from "../../components/ui/AppPrimitives";
import {
  useRouter } from "expo-router";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  } from "firebase/firestore";
import { getDownloadURL,
  ref,
  uploadBytesResumable } from "firebase/storage";
import { useCallback,
  useEffect,
  useMemo,
  useState } from "react";
import {
  Alert,
  Image,
  Platform,
  StyleSheet,
  View,
} from "react-native";

import Icon from "react-native-vector-icons/Feather";

import { EmptyState, ErrorState } from "../../components/AsyncState";
import { auth, db, storage } from "../../firebaseConfig";
import { useBookings } from "../../hooks/useOperationalData";
import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider";
import { staticColors } from "../../lib/design/staticColors";
import { designTokens as t } from "../../lib/design/tokens";
import PageShell from "../../components/layout/PageShell";

const TYPES = ["Parking", "Hotel", "Meal", "Other"];
const PAYMENT_METHODS = [
  { value: "personal", label: "Personal" },
  { value: "company_card", label: "Company card" },
];

function dateValue(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function expenseMonth(value) {
  const timestamp = dateValue(value);
  if (!timestamp) return { key: "earlier", label: "Earlier" };
  const date = new Date(timestamp);
  return {
    key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
    label: date.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
  };
}

function mostRecentBookingDate(booking) {
  const values = [
    ...(Array.isArray(booking?.bookingDates) ? booking.bookingDates : []),
    booking?.endDate,
    booking?.startDate,
    booking?.date,
    booking?.dateISO,
  ];
  return Math.max(0, ...values.map(dateValue));
}

function amountNumber(value) {
  const amount = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function pounds(value) {
  return `£${amountNumber(value).toFixed(2)}`;
}

function expenseLoadErrorCopy(error) {
  const code = String(error?.code || "").toLowerCase();
  if (code.includes("permission-denied")) {
    return {
      title: "Expense access needs enabling",
      message: "Your account is signed in, but it does not currently have access to expense claims. Contact the office if retrying does not resolve it.",
    };
  }
  if (code.includes("unavailable") || code.includes("network")) {
    return {
      title: "You appear to be offline",
      message: "Reconnect and retry to load your expense claims.",
    };
  }
  if (code.includes("session-missing") || code.includes("unauthenticated")) {
    return {
      title: "Sign in again",
      message: "Your session could not be verified. Sign out and back in before submitting an expense.",
    };
  }
  return {
    title: "Expenses unavailable",
    message: "Your claims could not be loaded. Please retry before adding another expense.",
  };
}

function ExpenseGuide({ colors }) {
  const items = [
    { icon: "camera", label: "Receipt", detail: "Photograph or attach the receipt" },
    { icon: "briefcase", label: "Job", detail: "Link the cost to a job when relevant" },
    { icon: "check-circle", label: "Review", detail: "Personal costs are submitted for approval" },
  ];

  return (
    <View style={[styles.guideCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}> 
      <Text style={[styles.guideTitle, { color: colors.text }]}>Before you submit</Text>
      <Text style={[styles.guideSubtitle, { color: colors.textMuted }]}>A complete claim is quicker for the office to approve.</Text>
      <View style={styles.guideItems}>
        {items.map((item) => (
          <View key={item.label} style={styles.guideItem}>
            <View style={[styles.guideIcon, { borderColor: colors.border }]}> 
              <Icon name={item.icon} size={16} color={colors.textMuted} />
            </View>
            <View style={styles.guideCopy}>
              <Text style={[styles.guideLabel, { color: colors.text }]}>{item.label}</Text>
              <Text style={[styles.guideDetail, { color: colors.textMuted }]}>{item.detail}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function bookingLabel(booking) {
  const number = String(booking?.jobNumber || booking?.bookingNumber || booking?.number || "").trim();
  const client = String(booking?.client || booking?.clientName || booking?.company || "").trim();
  const title = String(booking?.title || booking?.jobTitle || booking?.name || "").trim();
  return [number, client || title].filter(Boolean).join(" — ") || "Job";
}

async function uploadReceipt(uri, ownerId, expenseId) {
  const prepared = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1600 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
  );
  const response = await fetch(prepared.uri);
  const blob = await response.blob();
  const safeOwner = String(ownerId || "employee").replace(/[^a-zA-Z0-9_-]/g, "_");
  const receiptRef = ref(storage, `expenses/${safeOwner}/${expenseId}.jpg`);
  await new Promise((resolve, reject) => {
    const task = uploadBytesResumable(receiptRef, blob, { contentType: "image/jpeg" });
    task.on("state_changed", undefined, reject, resolve);
  });
  return getDownloadURL(receiptRef);
}

const EMPTY = {
  type: "Parking",
  otherType: "",
  paymentMethod: "personal",
  amount: "",
  jobId: "",
  note: "",
  receiptUrl: "",
};

export default function ExpensesPage() {
  const router = useRouter();
  const { colors } = useTheme();
  const { employee, user } = useAuth();
  const bookingsResource = useBookings({ employeeOnly: true });
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [jobListOpen, setJobListOpen] = useState(false);
  const [receiptUri, setReceiptUri] = useState("");
  const [saving, setSaving] = useState(false);

  const employeeCode = String(employee?.userCode || employee?.employeeCode || "").trim();
  const employeeId = String(employee?.id || employee?.employeeId || "").trim();
  const ownerUid = auth.currentUser?.uid || user?.uid || "";
  const receiptOwnerId = ownerUid || employeeCode;
  const jobs = useMemo(
    () =>
      (bookingsResource.data || [])
        .map((booking) => ({
          id: String(booking.id || booking.bookingId || ""),
          jobNumber: String(booking.jobNumber || booking.bookingNumber || ""),
          label: bookingLabel(booking),
          date: mostRecentBookingDate(booking),
        }))
        .filter((job) => job.id)
        .sort((a, b) => b.date - a.date || b.jobNumber.localeCompare(a.jobNumber))
        .slice(0, 12),
    [bookingsResource.data]
  );

  const loadExpenses = useCallback(async () => {
    if (!ownerUid) {
      setExpenses([]);
      const sessionError = new Error("Your session could not be verified.");
      sessionError.code = "auth/session-missing";
      setLoadError(sessionError);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setLoadError(null);
    try {
      const snapshot = await getDocs(
        query(collection(db, "expenses"), where("ownerUid", "==", ownerUid))
      );
      const rows = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) => dateValue(b.createdAt || b.updatedAt) - dateValue(a.createdAt || a.updatedAt));
      setExpenses(rows);
    } catch (error) {
      console.warn("Could not load expenses", error?.message || error);
      setLoadError(error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [ownerUid]);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

  const retryExpenses = useCallback(async () => {
    if (expenses.length > 0) setRefreshing(true);
    else setLoading(true);
    await loadExpenses();
  }, [expenses.length, loadExpenses]);

  const total = expenses
    .filter((item) => (item.paymentMethod || "personal") === "personal")
    .reduce((sum, item) => sum + amountNumber(item.amount), 0);
  const pending = expenses.filter((item) => !["approved", "rejected"].includes(String(item.status || "").toLowerCase())).length;
  const hasInitialLoadError = !loading && !!loadError && expenses.length === 0;
  const isEmpty = !loading && !loadError && expenses.length === 0;
  const loadErrorCopy = expenseLoadErrorCopy(loadError);
  const expenseAccessDenied = String(loadError?.code || "").toLowerCase().includes("permission-denied");
  const expenseSections = useMemo(() => {
    const sections = [];
    const sectionsByMonth = new Map();
    expenses.forEach((expense) => {
      const month = expenseMonth(expense.createdAt || expense.updatedAt);
      let section = sectionsByMonth.get(month.key);
      if (!section) {
        section = { ...month, items: [] };
        sectionsByMonth.set(month.key, section);
        sections.push(section);
      }
      section.items.push(expense);
    });
    return sections;
  }, [expenses]);

  const beginAdd = () => {
    setDraft({ ...EMPTY });
    setJobListOpen(false);
    setReceiptUri("");
    setEditorOpen(true);
  };

  const beginEdit = (expense) => {
    if (String(expense.status || "").toLowerCase() === "approved") {
      Alert.alert("Approved expense", "Approved expenses are locked. Contact your manager if it needs changing.");
      return;
    }
    setDraft({
      id: expense.id,
      type: expense.type || "Other",
      otherType: expense.otherType || "",
      paymentMethod: expense.paymentMethod || "personal",
      amount: String(expense.amount ?? ""),
      jobId: expense.jobId || "",
      note: expense.note || "",
      receiptUrl: expense.receiptUrl || "",
    });
    setJobListOpen(false);
    setReceiptUri("");
    setEditorOpen(true);
  };

  const pickReceipt = async () => {
    if (Platform.OS !== "web") {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert("Photo permission needed", "Allow photo access to attach a receipt.");
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.9,
    });
    if (!result.canceled && result.assets?.[0]?.uri) setReceiptUri(result.assets[0].uri);
  };

  const takeReceipt = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert("Camera permission needed", "Allow camera access to photograph a receipt.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      cameraType: ImagePicker.CameraType.back,
      quality: 0.9,
    });
    if (!result.canceled && result.assets?.[0]?.uri) setReceiptUri(result.assets[0].uri);
  };

  const saveExpense = async () => {
    const amount = amountNumber(draft.amount);
    if (amount <= 0) {
      Alert.alert("Amount required", "Enter the amount you are claiming.");
      return;
    }
    if (draft.type === "Other" && !String(draft.otherType || "").trim()) {
      Alert.alert("Expense type required", "Tell us what the expense was for.");
      return;
    }
    setSaving(true);
    try {
      if (!ownerUid) throw new Error("Your session could not be verified.");
      const id = draft.id || `${employeeCode}_${Date.now()}`;
      const selectedJob = jobs.find((job) => job.id === draft.jobId) || null;
      let receiptUrl = draft.receiptUrl || "";
      if (receiptUri) receiptUrl = await uploadReceipt(receiptUri, receiptOwnerId, id);
      const payload = {
        ownerUid,
        employeeId,
        employeeCode,
        employeeName: employee?.displayName || employee?.name || null,
        type: draft.type,
        otherType: draft.type === "Other" ? String(draft.otherType || "").trim() : null,
        paymentMethod: draft.paymentMethod,
        amount,
        jobId: selectedJob?.id || null,
        jobNumber: selectedJob?.jobNumber || null,
        jobLabel: selectedJob?.label || null,
        note: String(draft.note || "").trim(),
        receiptUrl,
        updatedAt: serverTimestamp(),
        ...(draft.id ? {} : { status: "submitted", createdAt: serverTimestamp() }),
      };
      await setDoc(doc(db, "expenses", id), payload, { merge: true });
      setEditorOpen(false);
      setReceiptUri("");
      await loadExpenses();
    } catch (error) {
      console.warn("Could not save expense", error?.message || error);
      Alert.alert("Expense not saved", error?.message || "Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const removeExpense = (expense) => {
    if (String(expense.status || "").toLowerCase() === "approved") return;
    Alert.alert("Delete expense?", `${expense.type} · ${pounds(expense.amount)}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            if (!ownerUid || expense.ownerUid !== ownerUid) {
              throw new Error("This expense could not be verified for your account.");
            }
            await deleteDoc(doc(db, "expenses", expense.id));
            setExpenses((current) => current.filter((item) => item.id !== expense.id));
          } catch (error) {
            Alert.alert("Delete failed", error?.message || "Could not delete this expense.");
          }
        },
      },
    ]);
  };

  return (
    <PageShell
      contentSpacing="compact"
      header={{
        variant: "compact",
        eyebrow: "Claims",
        title: "Expenses",
        subtitle: "Receipts and job costs",
        onBack: router.back,
        action: {
          label: "Add Expense",
          icon: "plus",
          onPress: beginAdd,
          disabled: !ownerUid || expenseAccessDenied,
        },
      }}
      state={{
        resources: [{
          data: expenses,
          error: expenses.length > 0 ? loadError : null,
          isInitialLoading: loading,
          isRefreshing: refreshing,
        }],
        hasContent: expenses.length > 0,
        onRetry: retryExpenses,
        loadingLabel: "Loading expenses…",
        refreshErrorMessage: "Could not refresh expenses. Showing your saved claims.",
      }}
      refresh={{ refreshing, onRefresh: retryExpenses }}
    >
      

      <>
        {hasInitialLoadError ? (
          <>
            <ErrorState
              title={loadErrorCopy.title}
              message={loadErrorCopy.message}
              onRetry={retryExpenses}
            />
            <ExpenseGuide colors={colors} />
          </>
        ) : isEmpty ? (
          <>
            <EmptyState
              icon="credit-card"
              title="No expenses yet"
              message="Add a receipt or job cost when you are ready."
              actionLabel="Add Expense"
              onAction={beginAdd}
            />
            <ExpenseGuide colors={colors} />
          </>
        ) : (
          <>
            <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}> 
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>PERSONAL CLAIMS</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{pounds(total)}</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>PENDING</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{pending}</Text>
          </View>
            </View>

            {expenseSections.map((section) => (
            <View key={section.key} style={styles.monthSection}>
              <View style={styles.monthHeader}>
                <Text style={[styles.monthTitle, { color: colors.text }]}>{section.label}</Text>
                <Text style={[styles.monthCount, { color: colors.textMuted }]}>
                  {section.items.length} {section.items.length === 1 ? "expense" : "expenses"}
                </Text>
              </View>
              <View style={styles.monthCards}>
                {section.items.map((expense) => {
                  const status = String(expense.status || "submitted").toLowerCase();
                  const statusColor = status === "approved" ? staticColors.hex_42c983_5qoknl : status === "rejected" ? colors.danger : staticColors.hex_d99a21_6chiqo;
                  return (
                    <TouchableOpacity key={expense.id} style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} onPress={() => beginEdit(expense)}>
                      <View style={styles.cardTop}>
                        {expense.receiptUrl ? <Image source={{ uri: expense.receiptUrl }} style={styles.thumb} /> : (
                          <View style={[styles.iconBox, { borderColor: colors.border }]}><Icon name="credit-card" size={18} color={colors.textMuted} /></View>
                        )}
                        <View style={styles.cardCopy}>
                          <Text style={[styles.cardTitle, { color: colors.text }]}>{expense.type === "Other" && expense.otherType ? expense.otherType : expense.type}</Text>
                          <Text style={[styles.cardMeta, { color: colors.textMuted }]}>{expense.paymentMethod === "company_card" ? "Company card" : "Personal"}</Text>
                          <Text style={[styles.cardMeta, { color: colors.textMuted }]} numberOfLines={1}>{expense.jobLabel || "Not attached to a job"}</Text>
                        </View>
                        <View style={styles.cardAmountWrap}>
                          <Text style={[styles.cardAmount, { color: colors.text }]}>{pounds(expense.amount)}</Text>
                          <Text style={[styles.status, { color: statusColor, borderColor: statusColor }]}>{status}</Text>
                        </View>
                      </View>
                      {expense.note ? <Text style={[styles.detail, { color: colors.text }]}>{expense.note}</Text> : null}
                      {status !== "approved" && (
                        <TouchableOpacity style={styles.deleteButton} onPress={() => removeExpense(expense)}>
                          <Icon name="trash-2" size={14} color={colors.danger} />
                          <Text style={{ color: colors.danger, fontWeight: "800", fontSize: t.typography.metadata.fontSize }}>Delete</Text>
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
          </>
        )}
      </>

      <AppModal
        visible={editorOpen}
        title={draft.id ? "Edit expense" : "Add expense"}
        onRequestClose={() => { if (!saving) { setJobListOpen(false); setEditorOpen(false); } }}
        scrollable
        busy={saving}
      >
              <Text tone="secondary">Add the cost and choose its job.</Text>

              <Text style={[styles.label, { color: colors.textMuted }]}>Type</Text>
              <View style={styles.choices}>{TYPES.map((type) => <TouchableOpacity key={type} style={[styles.choice, { borderColor: draft.type === type ? colors.accent : colors.border, backgroundColor: draft.type === type ? colors.accentSoft : colors.surfaceAlt }]} onPress={() => setDraft((current) => ({ ...current, type }))}><Text style={{ color: colors.text, fontWeight: "800" }}>{type}</Text></TouchableOpacity>)}</View>
              {draft.type === "Other" ? (
                <FormField
                  label="Other expense type"
                  value={draft.otherType}
                  onChangeText={(otherType) => setDraft((current) => ({ ...current, otherType }))}
                  placeholder="What type of expense?"
                  maxLength={60}
                  inputProps={{ autoFocus: true }}
                />
              ) : null}

              <View style={styles.formRow}>
                <View style={styles.formColumn}>
                  <FormField label="Amount" value={draft.amount} onChangeText={(amount) => setDraft((current) => ({ ...current, amount }))} placeholder="£0.00" inputProps={{ keyboardType: "decimal-pad" }} />
                </View>
                <View style={styles.formColumnWide}>
                  <Text style={[styles.label, { color: colors.textMuted }]}>Paid with</Text>
                  <View style={styles.paymentChoices}>{PAYMENT_METHODS.map((method) => <TouchableOpacity key={method.value} style={[styles.paymentChoice, { borderColor: draft.paymentMethod === method.value ? colors.accent : colors.border, backgroundColor: draft.paymentMethod === method.value ? colors.accentSoft : colors.surfaceAlt }]} onPress={() => setDraft((current) => ({ ...current, paymentMethod: method.value }))}><Text numberOfLines={1} style={{ color: colors.text, fontWeight: "800", fontSize: t.typography.metadata.fontSize }}>{method.label}</Text></TouchableOpacity>)}</View>
                </View>
              </View>

              <Text style={[styles.label, { color: colors.textMuted }]}>Job</Text>
              <TouchableOpacity
                style={[styles.jobSelect, { borderColor: jobListOpen ? colors.accent : colors.inputBorder, backgroundColor: colors.inputBackground }]}
                onPress={() => setJobListOpen((open) => !open)}
              >
                <Text numberOfLines={1} style={[styles.jobSelectText, { color: colors.text }]}>
                  {jobs.find((job) => job.id === draft.jobId)?.label || "No job"}
                </Text>
                <Icon name={jobListOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.textMuted} />
              </TouchableOpacity>
              {jobListOpen ? (
                <View style={[styles.jobList, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
                  <View nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {[{ id: "", label: "No job" }, ...jobs].map((job) => {
                      const selected = draft.jobId === job.id;
                      return (
                        <TouchableOpacity
                          key={job.id || "no-job"}
                          style={[styles.jobOption, { borderBottomColor: colors.border, backgroundColor: selected ? colors.accentSoft : "transparent" }]}
                          onPress={() => {
                            setDraft((current) => ({ ...current, jobId: job.id }));
                            setJobListOpen(false);
                          }}
                        >
                          <Text numberOfLines={1} style={[styles.jobOptionText, { color: selected ? colors.accent : colors.text }]}>{job.label}</Text>
                          {selected ? <Icon name="check" size={17} color={colors.accent} /> : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              <TextArea label="Notes" value={draft.note} onChangeText={(note) => setDraft((current) => ({ ...current, note }))} placeholder="What was this expense for?" />
              <Text style={[styles.label, { color: colors.textMuted }]}>Receipt photo</Text>
              <View style={styles.receiptRow}>
                {receiptUri || draft.receiptUrl ? <Image source={{ uri: receiptUri || draft.receiptUrl }} style={[styles.receiptPreview, { borderColor: colors.border }]} /> : null}
                <TouchableOpacity style={[styles.receiptAction, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]} onPress={pickReceipt}>
                  <Icon name="image" size={18} color={colors.textMuted} />
                  <Text style={[styles.receiptActionText, { color: colors.text }]}>Choose photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.receiptAction, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]} onPress={takeReceipt}>
                  <Icon name="camera" size={18} color={colors.textMuted} />
                  <Text style={[styles.receiptActionText, { color: colors.text }]}>Take photo</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={[styles.save, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]} onPress={saveExpense} disabled={saving}><Text style={styles.saveText}>{saving ? "Saving…" : "Submit expense"}</Text></TouchableOpacity>
      </AppModal>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, header: { minHeight: 86, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: t.spacing.md, gap: t.spacing.sm }, backButton: { width: 38, height: 38, justifyContent: "center" }, headerCopy: { flex: 1 }, title: { fontSize: t.typography.pageTitle.fontSize, fontWeight: "900" }, subtitle: { fontSize: t.typography.metadata.fontSize, marginTop: t.spacing.none }, addButton: { minHeight: 38, paddingHorizontal: t.spacing.sm, borderRadius: t.radius.pill, flexDirection: "row", alignItems: "center", gap: t.spacing.xxs }, addButtonText: { color: staticColors.hex_fff_yhjmu8, fontWeight: "900" },
  content: { padding: t.spacing.md, paddingBottom: 50, gap: t.spacing.sm }, statsRow: { flexDirection: "row", gap: t.spacing.xs }, statCard: { flex: 1, borderWidth: 1, borderRadius: t.radius.lg, padding: t.spacing.sm }, statLabel: { fontSize: t.typography.micro.fontSize, fontWeight: "800", letterSpacing: 0.8 }, statValue: { fontSize: t.typography.titleSmall.fontSize, fontWeight: "900", marginTop: t.spacing.xxs },
  empty: { borderWidth: 1, borderRadius: t.radius.xl, padding: t.spacing["2xl"], alignItems: "center", gap: t.spacing.xs, marginTop: t.spacing.xs }, emptyTitle: { fontSize: t.typography.sectionTitle.fontSize, fontWeight: "900" }, emptyText: { textAlign: "center", lineHeight: 19 },
  guideCard: { borderWidth: 1, borderRadius: t.radius.lg, padding: t.spacing.sm },
  guideTitle: { fontSize: t.typography.bodyLarge.fontSize, fontWeight: "900" },
  guideSubtitle: { fontSize: t.typography.metadata.fontSize, lineHeight: t.typography.metadata.lineHeight, marginTop: t.spacing.none },
  guideItems: { marginTop: t.spacing.xs },
  guideItem: { minHeight: t.controls.buttonHeight, flexDirection: "row", alignItems: "center" },
  guideIcon: { width: 32, height: 32, borderRadius: t.radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  guideCopy: { flex: 1, minWidth: 0, marginLeft: t.spacing.xs },
  guideLabel: { fontSize: t.typography.body.fontSize, fontWeight: "800" },
  guideDetail: { fontSize: t.typography.metadata.fontSize, lineHeight: t.typography.metadata.lineHeight },
  monthSection: { gap: t.spacing.xs, marginTop: t.spacing.xxs }, monthHeader: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: t.spacing.none }, monthTitle: { fontSize: t.typography.titleSmall.fontSize, fontWeight: "900" }, monthCount: { fontSize: t.typography.caption.fontSize, fontWeight: "800" }, monthCards: { gap: t.spacing.xs },
  card: { borderWidth: 1, borderRadius: t.radius.lg, padding: t.spacing.sm }, cardTop: { flexDirection: "row", alignItems: "center", gap: t.spacing.xs }, thumb: { width: 48, height: 48, borderRadius: t.radius.md }, iconBox: { width: 48, height: 48, borderRadius: t.radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" }, cardCopy: { flex: 1, minWidth: 0 }, cardTitle: { fontSize: t.typography.bodyLarge.fontSize, fontWeight: "900" }, cardMeta: { fontSize: t.typography.caption.fontSize, marginTop: t.spacing.none }, cardAmountWrap: { alignItems: "flex-end", gap: t.spacing.xxs }, cardAmount: { fontSize: t.typography.sectionTitle.fontSize, fontWeight: "900" }, status: { borderWidth: 1, borderRadius: t.radius.pill, paddingHorizontal: t.spacing.xs, paddingVertical: t.spacing.none, fontSize: t.typography.micro.fontSize, fontWeight: "900", textTransform: "uppercase" }, detail: { fontSize: t.typography.metadata.fontSize, marginTop: t.spacing.xs }, deleteButton: { alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: t.spacing.xxs, paddingTop: t.spacing.xs },
  overlay: { flex: 1, backgroundColor: staticColors.rgba_18a7uad, alignItems: "center", justifyContent: "center", padding: t.spacing.sm }, modal: { width: "100%", maxWidth: 620, maxHeight: "94%", borderWidth: 1, borderRadius: t.radius.xl }, modalContent: { padding: t.spacing.sm, paddingBottom: t.spacing.sm }, modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: t.spacing.xxs }, modalTitle: { fontSize: t.typography.titleSmall.fontSize, fontWeight: "900" }, modalSubtitle: { fontSize: t.typography.metadata.fontSize, marginTop: t.spacing.none }, close: { width: 36, height: 36, borderRadius: t.radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" }, label: { fontSize: t.typography.micro.fontSize, fontWeight: "800", marginBottom: t.spacing.xxs, marginTop: t.spacing.xs, textTransform: "uppercase", letterSpacing: 0.6 }, choices: { flexDirection: "row", gap: t.spacing.xxs }, choice: { minHeight: 38, borderWidth: 1, borderRadius: t.radius.md, paddingHorizontal: t.spacing.sm, justifyContent: "center" }, otherTypeInput: { marginTop: t.spacing.xs }, formRow: { flexDirection: "row", gap: t.spacing.xs }, formColumn: { flex: 0.8 }, formColumnWide: { flex: 1.4 }, paymentChoices: { flexDirection: "row", gap: t.spacing.xxs }, paymentChoice: { flex: 1, minHeight: 46, borderWidth: 1, borderRadius: t.radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: t.spacing.xxs }, input: { minHeight: 46, borderWidth: 1, borderRadius: t.radius.md, paddingHorizontal: t.spacing.sm, fontSize: t.typography.bodyLarge.fontSize }, jobSelect: { minHeight: 46, borderWidth: 1, borderRadius: t.radius.md, paddingHorizontal: t.spacing.sm, flexDirection: "row", alignItems: "center", gap: t.spacing.xs }, jobSelectText: { flex: 1, fontSize: t.typography.body.fontSize, fontWeight: "800" }, jobList: { maxHeight: 190, borderWidth: 1, borderRadius: t.radius.md, overflow: "hidden", marginTop: t.spacing.xxs }, jobOption: { minHeight: 43, paddingHorizontal: t.spacing.sm, flexDirection: "row", alignItems: "center", gap: t.spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth }, jobOptionText: { flex: 1, fontSize: t.typography.bodySmall.fontSize, fontWeight: "700" }, notes: { minHeight: 58, paddingTop: t.spacing.xs, textAlignVertical: "top" }, receiptRow: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: t.spacing.xs }, receiptAction: { flex: 1, minHeight: 46, borderWidth: 1, borderRadius: t.radius.md, paddingHorizontal: t.spacing.xs, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: t.spacing.xxs }, receiptActionText: { fontSize: t.typography.metadata.fontSize, fontWeight: "800" }, receiptPreview: { width: 46, height: 46, borderRadius: t.radius.md, borderWidth: 1 }, save: { minHeight: 46, borderRadius: t.radius.lg, alignItems: "center", justifyContent: "center", marginTop: t.spacing.sm }, saveText: { color: staticColors.hex_fff_yhjmu8, fontWeight: "900", fontSize: t.typography.bodyLarge.fontSize },
});
