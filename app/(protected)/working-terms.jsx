import { useCallback, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { signOut } from "firebase/auth";
import {
  Alert,
  StyleSheet,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { auth } from "../../firebaseConfig";
import PageShell from "../../components/layout/PageShell";
import {
  AppButton,
  AppText,
  Banner,
  Checkbox,
  FormField,
  PageSection,
  SectionCard,
} from "../../components/ui/AppPrimitives";
import SignatureField from "../../components/ui/SignatureField";
import { designTokens as t } from "../../lib/design/tokens";
import { resolveWorkspaceAccess } from "../../lib/access";
import {
  WORKING_TERMS_ACCEPTANCE_TEXT,
  WORKING_TERMS_EFFECTIVE_DATE,
  WORKING_TERMS_SECTIONS,
  WORKING_TERMS_VERSION,
} from "../../lib/workingTerms";
import { signWorkingTerms } from "../../lib/workingTermsApi";
import { useAuth } from "../../providers/AuthProvider";

function Paragraphs({ values }) {
  if (!values?.length) return null;
  return values.map((paragraph, index) => (
    <AppText key={index} variant="body" layoutStyle={styles.paragraph}>
      {paragraph}
    </AppText>
  ));
}

function Bullets({ values }) {
  if (!values?.length) return null;
  return values.map((bullet, index) => (
    <View key={index} style={styles.bulletRow}>
      <AppText variant="body">•</AppText>
      <AppText variant="body" layoutStyle={styles.bulletText}>{bullet}</AppText>
    </View>
  ));
}

function formatAcceptanceDate(value) {
  const date = typeof value?.toDate === "function" ? value.toDate() : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function WorkingTermsPage() {
  const {
    user,
    employee,
    reloadSession,
    refreshWorkingTermsAcceptance,
    workingTermsAcceptance,
    workingTermsAccepted,
  } = useAuth();
  const router = useRouter();
  const [hasReachedEnd, setHasReachedEnd] = useState(false);
  const [fullName, setFullName] = useState(employee?.displayName || user?.displayName || "");
  const [signatureSvgPath, setSignatureSvgPath] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [signatureDrawing, setSignatureDrawing] = useState(false);
  const acceptedAtLabel = formatAcceptanceDate(workingTermsAcceptance?.acceptedAt);

  const returnToApp = useCallback(() => {
    const access = resolveWorkspaceAccess(employee);
    const destination =
      access.service && !access.user
        ? "/(protected)/service/home"
        : "/(protected)/screens/homescreen";
    router.replace(destination);
  }, [employee, router]);

  const canSign =
    !workingTermsAccepted &&
    hasReachedEnd &&
    agreed &&
    fullName.trim().length >= 2 &&
    signatureSvgPath.length >= 20;

  const handleScroll = ({ nativeEvent }) => {
    const distanceFromEnd =
      nativeEvent.contentSize.height -
      (nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height);
    if (distanceFromEnd < 64) setHasReachedEnd(true);
  };

  const handleSign = async () => {
    if (!canSign || submitting) return;
    setSubmitting(true);
    try {
      await signWorkingTerms({
        firebaseUser: user,
        employee,
        fullName,
        signatureSvgPath,
      });
      const accepted = await refreshWorkingTermsAcceptance();
      if (!accepted) {
        throw new Error("Your signature was saved, but app access could not be refreshed.");
      }
      returnToApp();
    } catch (error) {
      Alert.alert(
        "Signature not saved",
        error?.message || "We could not save your signature. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = async () => {
    if (closing || submitting) return;
    setClosing(true);
    try {
      await AsyncStorage.multiRemove([
        "sessionRole",
        "sessionIsService",
        "sessionUserAccess",
        "sessionServiceAccess",
        "sessionCompanyId",
        "displayName",
        "employeeId",
        "employeeEmail",
        "employeeUserCode",
        "userCode",
        "timesheetYardStart",
        "timesheetYardEnd",
        "timesheetOfficeStart",
        "timesheetOfficeEnd",
        "timesheetWorkshopStart",
        "timesheetWorkshopEnd",
        "timesheetDefaultType",
      ]);
      global.employee = null;
      await signOut(auth);
      await reloadSession();
      router.replace("/(auth)/login");
    } catch (error) {
      Alert.alert(
        "Could not return to login",
        error?.message || "Please try again."
      );
      setClosing(false);
    }
  };

  return (
    <PageShell
      mode="form"
      width="form"
      contentSpacing="standard"
      header={{
        variant: "hero",
        eyebrow: `${workingTermsAccepted ? "Signed" : "Required"} • Version ${WORKING_TERMS_VERSION}`,
        title: "Working Terms",
        subtitle: workingTermsAccepted
          ? `Effective ${WORKING_TERMS_EFFECTIVE_DATE}. Your signed copy remains available here.`
          : `Effective ${WORKING_TERMS_EFFECTIVE_DATE}. Read and sign to continue using the app.`,
        action: {
          label: "Close and return to login",
          icon: "x",
          iconOnly: true,
          variant: "secondary",
          onPress: handleClose,
          disabled: submitting,
          loading: closing,
        },
      }}
      scrollProps={{
        onScroll: handleScroll,
        scrollEnabled: !signatureDrawing,
        scrollEventThrottle: 32,
      }}
    >
      {workingTermsAccepted ? (
        <View style={styles.signedStatus}>
          <Banner title="Signed and accepted" tone="success" icon="check-circle">
            {`Accepted by ${workingTermsAcceptance?.fullName || "this account"}${acceptedAtLabel ? ` on ${acceptedAtLabel}` : ""}.`}
          </Banner>
          <AppButton label="Return to app" icon="arrow-right" onPress={returnToApp} />
        </View>
      ) : (
        <Banner title="App access is paused" tone="warning" icon="lock">
          Your account stays signed in, but jobs, timesheets and other app areas remain locked until this version is signed.
        </Banner>
      )}

      <SectionCard>
        <AppText variant="sectionTitle" layoutStyle={styles.sectionTitle}>
          Document details
        </AppText>
        <View style={styles.detailGrid}>
          <View style={styles.detailItem}>
            <AppText variant="caption" tone="muted">Version</AppText>
            <AppText variant="bodyStrong">{WORKING_TERMS_VERSION}</AppText>
          </View>
          <View style={styles.detailItem}>
            <AppText variant="caption" tone="muted">Effective date</AppText>
            <AppText variant="bodyStrong">{WORKING_TERMS_EFFECTIVE_DATE}</AppText>
          </View>
          <View style={styles.detailItem}>
            <AppText variant="caption" tone="muted">Document length</AppText>
            <AppText variant="bodyStrong">{WORKING_TERMS_SECTIONS.length} sections</AppText>
          </View>
        </View>
        <AppText variant="bodySmall" tone="muted" layoutStyle={styles.scopeNote}>
          Applies according to role and employment status, including employees, workers, self-employed freelancers and subcontractors.
        </AppText>
      </SectionCard>

      <View style={styles.termsDocument}>
        {WORKING_TERMS_SECTIONS.map((section, index) => (
          <PageSection
            key={section.title}
            title={section.title}
            divided={index > 0}
            layoutStyle={styles.termsSection}
          >
            <Paragraphs values={section.paragraphs} />
            {section.subsections?.map((subsection) => (
              <View key={subsection.title} style={styles.subsection}>
                <AppText variant="bodyStrong" layoutStyle={styles.subsectionTitle}>
                  {subsection.title}
                </AppText>
                <Paragraphs values={subsection.paragraphs} />
                <Bullets values={subsection.bullets} />
                <Paragraphs values={subsection.afterBullets} />
                <Bullets values={subsection.moreBullets} />
              </View>
            ))}
          </PageSection>
        ))}
      </View>

      {!workingTermsAccepted ? <SectionCard>
        <AppText variant="sectionTitle" layoutStyle={styles.sectionTitle}>
          Acceptance of Terms
        </AppText>
        <AppText variant="body" layoutStyle={styles.paragraph}>
          {WORKING_TERMS_ACCEPTANCE_TEXT}
        </AppText>
        <Banner title={`You are signing Version ${WORKING_TERMS_VERSION}`} tone="info">
          {`Effective ${WORKING_TERMS_EFFECTIVE_DATE}. The app records the signing date and time automatically.`}
        </Banner>
        {!hasReachedEnd ? (
          <Banner title="Read the full document" tone="info" icon="arrow-down">
            Scroll through all terms before signing.
          </Banner>
        ) : null}
        <FormField
          required
          label="Full legal name"
          value={fullName}
          onChangeText={setFullName}
          inputProps={{ autoCapitalize: "words", autoComplete: "name" }}
        />
        <SignatureField
          label="Signature *"
          value={signatureSvgPath}
          onChange={setSignatureSvgPath}
          onDrawingStateChange={setSignatureDrawing}
          layoutStyle={styles.signatureField}
        />
        <Checkbox
          checked={agreed}
          disabled={!hasReachedEnd}
          onChange={setAgreed}
          label={`I have read, understood and agree to the Bickers Action Working Terms, Version ${WORKING_TERMS_VERSION}.`}
          layoutStyle={styles.checkboxLayout}
        />
        <AppText variant="caption" tone="muted">
          Your name, signature, account identity, document version, app version and signing time will be recorded.
        </AppText>
        <AppButton
          fullWidth
          label="Sign and continue"
          icon="check-circle"
          disabled={!canSign}
          loading={submitting}
          onPress={handleSign}
          layoutStyle={styles.signButton}
        />
      </SectionCard> : null}
    </PageShell>
  );
}

const styles = StyleSheet.create({
  signedStatus: { gap: t.spacing.md },
  sectionTitle: { marginBottom: t.spacing.sm },
  termsDocument: { paddingHorizontal: t.spacing.xs },
  termsSection: { paddingVertical: t.spacing.xl },
  subsection: { marginTop: t.spacing.md },
  subsectionTitle: { marginBottom: t.spacing.xs },
  paragraph: { marginBottom: t.spacing.sm },
  bulletRow: { flexDirection: "row", gap: t.spacing.xs, marginBottom: t.spacing.sm },
  bulletText: { flex: 1 },
  signatureField: { marginTop: t.spacing.md },
  checkboxLayout: { marginTop: t.spacing.md, alignItems: "flex-start" },
  signButton: { marginTop: t.spacing.lg },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: t.spacing.md },
  detailItem: { minWidth: 110, flexGrow: 1 },
  scopeNote: { marginTop: t.spacing.md },
});
