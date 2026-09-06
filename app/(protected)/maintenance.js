import {
  AppButton,
  AppText as Text,
  Banner,
  FormStep,
  PageSection,
  SelectField,
  StateView,
  TextArea,
} from "../../components/ui/AppPrimitives";
// app/(protected)/vehicle-issues.js
import { useRouter } from "expo-router";
import {
  addDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

// 🔑 Firebase + Auth provider (paths for app/(protected)/*)
import PageShell from "../../components/layout/PageShell";
import { db } from "../../firebaseConfig";
import { useEquipment, useVehicles } from "../../hooks/useOperationalData";
import { designTokens as t } from "../../lib/design/tokens";
import {
  getEquipmentCategory,
  getEquipmentName,
  getVehicleDisplayLabel,
  getVehicleDisplayName,
  getVehicleRegistration,
} from "../../lib/fleetSchema";
import { useAuth } from "../../providers/AuthProvider";

const MAX_CHARS = 600;
const ASSET_TYPES = [
  { label: "Vehicle", value: "vehicle" },
  { label: "Equipment", value: "equipment" },
];

// normalise category
const normalizeCategory = (cat) => {
  if (typeof cat !== "string") return "Other";
  const c = cat.trim();
  return c.length ? c : "Other";
};

const getEquipmentIdentifier = (equipment) =>
  String(
    equipment?.serialNumber || equipment?.equipmentId || equipment?.asset || ""
  ).trim();

const getEquipmentDisplayLabel = (equipment) => {
  const name = String(getEquipmentName(equipment) || "Unnamed equipment").trim();
  const identifier = getEquipmentIdentifier(equipment);
  return identifier ? `${name} · ${identifier}` : name;
};

export default function VehicleIssuesPage() {
  const router = useRouter();

  // ✅ mirror me.js
  const { employee, user, isAuthed, loading } = useAuth();
  const vehiclesResource = useVehicles();
  const equipmentResource = useEquipment();
  const vehicles = vehiclesResource.data;
  const equipment = equipmentResource.data;

  const [selectedAssetType, setSelectedAssetType] = useState("vehicle");

  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedAsset, setSelectedAsset] = useState("");
  const [issueText, setIssueText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const normalizedVehicles = useMemo(
    () => vehicles.map((v) => ({ ...v, category: normalizeCategory(v.category) })),
    [vehicles]
  );

  // Fleet Vehicles are valid maintenance targets. This screen previously
  // filtered that category out, which left many employees with nothing to report.
  const reportableVehicles = normalizedVehicles;

  const normalizedEquipment = useMemo(
    () =>
      equipment.map((item) => ({
        ...item,
        category: normalizeCategory(getEquipmentCategory(item) || "Equipment"),
      })),
    [equipment]
  );

  const reportableAssets =
    selectedAssetType === "equipment" ? normalizedEquipment : reportableVehicles;
  const activeResource =
    selectedAssetType === "equipment" ? equipmentResource : vehiclesResource;
  const loadingAssets = activeResource.isInitialLoading;
  const assetLoadError = activeResource.error;

  const categories = useMemo(() => {
    const set = new Set(reportableAssets.map((asset) => asset.category));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [reportableAssets]);

  const filteredAssets = useMemo(() => {
    if (!selectedCategory) return [];
    return reportableAssets.filter((asset) => asset.category === selectedCategory);
  }, [reportableAssets, selectedCategory]);

  const selectedAssetRecord = useMemo(
    () => reportableAssets.find((asset) => asset.id === selectedAsset) || null,
    [reportableAssets, selectedAsset]
  );
  const selectedRegistration =
    selectedAssetType === "vehicle" ? getVehicleRegistration(selectedAssetRecord) : "";
  const selectedEquipmentIdentifier =
    selectedAssetType === "equipment"
      ? getEquipmentIdentifier(selectedAssetRecord)
      : "";

  const isValid =
    selectedCategory && selectedAsset && issueText.trim().length > 0;

  useEffect(() => {
    setSelectedCategory("");
    setSelectedAsset("");
  }, [selectedAssetType]);

  // clear vehicle when category changes
  useEffect(() => {
    setSelectedAsset("");
  }, [selectedCategory]);

  const reportIssue = async () => {
    if (!isValid) {
      Alert.alert(
        "Missing info",
        "Please complete all fields before submitting."
      );
      return;
    }
    try {
      setSubmitting(true);
      const asset = reportableAssets.find((item) => item.id === selectedAsset);
      const companyId = String(employee?.companyId || "").trim();
      if (!asset) {
        throw new Error("The selected asset is no longer available.");
      }
      if (!companyId) {
        throw new Error("The employee account is not linked to a company.");
      }
      const reporterName =
        employee?.name ||
        employee?.displayName ||
        user?.displayName ||
        "Unknown";
      const reporterCode = employee?.userCode || "N/A";
      const reporterUid = user?.uid || "N/A";

      await addDoc(collection(db, "vehicleIssues"), {
        companyId,
        assetType: selectedAssetType,
        assetId: asset.id,
        assetName:
          selectedAssetType === "equipment"
            ? getEquipmentName(asset) || "Unnamed equipment"
            : getVehicleDisplayName(asset, vehicles),
        ...(selectedAssetType === "equipment"
          ? {
              equipmentDocId: asset.id,
              equipmentId: getEquipmentIdentifier(asset),
              equipmentName: getEquipmentName(asset) || "Unnamed equipment",
              serialNumber: String(asset.serialNumber || "").trim(),
              asset: String(asset.asset || "").trim(),
            }
          : {
              vehicleId: asset.id,
              vehicleName: getVehicleDisplayName(asset, vehicles),
              registration: getVehicleRegistration(asset),
            }),
        category: asset.category || "Other",
        description: issueText.trim(),
        // reporter meta (matches provider pattern)
        reporterName,
        reporterCode,
        reporterUid,
        status: "open", // simple workflow
        createdAt: serverTimestamp(), // server time
      });

      Alert.alert(
        "✅ Issue reported",
        `Thanks! We logged an issue for ${
          selectedAssetType === "equipment"
            ? getEquipmentDisplayLabel(asset)
            : getVehicleDisplayLabel(asset, vehicles)
        }.`,
        [
          {
            text: "OK",
            onPress: () => {
              // clear form
              setIssueText("");
              setSelectedAsset("");
              setSelectedCategory("");
              // go home
              router.replace("/(protected)/screens/homescreen");
            },
          },
        ]
      );
    } catch (err) {
      console.error("Error reporting issue:", err);
      Alert.alert("❌ Error", "Failed to report the issue. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // follow me.js: render nothing while resolving or unauthenticated (protected route)
  if (loading || !isAuthed) return null;

  return (
    <PageShell
      mode="form"
      width="form"
      header={{
        variant: "compact",
        eyebrow: "Maintenance",
        title: "Report an issue",
        subtitle: "Tell us what needs attention",
        onBack: () => router.back(),
      }}
    >
      <View style={styles.container}>
        <Banner title="Quick report" icon="tool">
          Choose the asset, then describe the problem. The maintenance team will be notified.
        </Banner>

        <PageSection divided={false} layoutStyle={styles.formFlow}>
          <FormStep number={1} title="Choose the asset type" hint="What needs attention?">
            <SelectField
              label="Asset type"
              value={selectedAssetType}
              onChange={setSelectedAssetType}
              placeholder="Select asset type"
              disabled={submitting}
              options={ASSET_TYPES}
              testID="asset-type-select"
            />
          </FormStep>

          {/* Loading / Empty */}
          {loadingAssets ? (
            <StateView
              state="loading"
              compact
              title={`Loading ${selectedAssetType === "equipment" ? "equipment" : "vehicles"}…`}
            />
          ) : assetLoadError && reportableAssets.length === 0 ? (
            <StateView
              state="error"
              compact
              title={`${selectedAssetType === "equipment" ? "Equipment" : "Vehicles"} could not be loaded`}
              message="Check your connection and try again."
              actionLabel="Retry"
              onAction={activeResource.refresh}
            />
          ) : reportableAssets.length === 0 ? (
            <StateView
              state="empty"
              compact
              icon={selectedAssetType === "equipment" ? "tool" : "truck"}
              title={`No ${selectedAssetType === "equipment" ? "equipment" : "vehicles"} found`}
              message={`Add ${selectedAssetType === "equipment" ? "equipment" : "vehicles"} in the admin area, then report issues here.`}
            />
          ) : (
            <>
              {/* Category */}
              <FormStep number={2} title="Narrow the asset list" hint="Choose a category">
                <SelectField
                  label="Category"
                  value={selectedCategory}
                  onChange={setSelectedCategory}
                  placeholder="Select category"
                  disabled={submitting}
                  options={categories.map((category) => ({ label: category, value: category }))}
                  searchable={categories.length > 8}
                  testID="category-select"
                />
              </FormStep>

              {/* Asset */}
              <FormStep
                number={3}
                title="Select the specific asset"
                hint={selectedAssetType === "equipment" ? "Equipment" : "Vehicle"}
              >
                <SelectField
                  label={selectedAssetType === "equipment" ? "Equipment" : "Vehicle"}
                  value={selectedAsset}
                  onChange={setSelectedAsset}
                  placeholder={`Select ${selectedAssetType === "equipment" ? "Equipment" : "Vehicle"}`}
                  disabled={!selectedCategory || submitting}
                  options={filteredAssets.map((asset) => ({
                    label:
                      selectedAssetType === "equipment"
                        ? getEquipmentDisplayLabel(asset)
                        : getVehicleDisplayLabel(asset, vehicles),
                    value: asset.id,
                  }))}
                  searchable
                  testID="vehicle-select"
                />

                {selectedAsset ? (
                  <View style={styles.metaRow}>
                    <Text variant="metadata" tone="secondary">
                      {selectedAssetType === "equipment" ? "Equipment" : "Vehicle"}:{" "}
                      <Text variant="metadata">
                        {selectedAssetType === "equipment"
                          ? getEquipmentName(selectedAssetRecord) || "Unnamed equipment"
                          : getVehicleDisplayName(selectedAssetRecord, vehicles)}
                      </Text>
                    </Text>
                    {selectedRegistration ? (
                      <Text variant="metadata" tone="secondary">
                        Reg:{" "}
                        <Text variant="metadata">
                          {selectedRegistration}
                        </Text>
                      </Text>
                    ) : null}
                    {selectedEquipmentIdentifier ? (
                      <Text variant="metadata" tone="secondary">
                        ID:{" "}
                        <Text variant="metadata">
                          {selectedEquipmentIdentifier}
                        </Text>
                      </Text>
                    ) : null}
                    <Text variant="metadata" tone="secondary">
                      Cat:{" "}
                      <Text variant="metadata">
                        {selectedCategory || "Other"}
                      </Text>
                    </Text>
                  </View>
                ) : null}
              </FormStep>

              {/* Issue description */}
              <FormStep number={4} title="Describe the issue" hint="Include warning lights, sounds or symptoms" last>
                <TextArea
                  label="Issue details"
                  disabled={!selectedAsset || submitting}
                  placeholder="e.g. Brakes squeaking above 40mph, warning light on, tyre low…"
                  value={issueText}
                  onChangeText={setIssueText}
                  maxLength={MAX_CHARS}
                  showCount
                />
                <AppButton
                  label={submitting ? "Submitting…" : "Report issue"}
                  icon="send"
                  onPress={reportIssue}
                  disabled={!isValid || submitting}
                  loading={submitting}
                  fullWidth
                />
              </FormStep>
            </>
          )}
        </PageSection>

        <View style={styles.bottomSpacer} />
      </View>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  formFlow: {
    marginTop: t.spacing.xs,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: t.spacing.xs,
    marginTop: t.spacing.xs,
  },
  bottomSpacer: { height: t.spacing.xs },
});
