import { StyleSheet, View } from "react-native";

import BottomNavigationBar from "../app/BottomNavigationBar";
import {
  AppButton,
  AppText,
  Banner,
  Checkbox,
  DateField,
  FormField,
  FormStep,
  ListRow,
  PageSection,
  SectionCard,
  SectionHeader,
  SelectField,
  StateView,
  StatusChip,
  ToggleRow,
} from "../ui/AppPrimitives";
import { designTokens as t } from "../../lib/design/tokens";

const noop = () => {};

function ComponentsScenario() {
  return (
    <>
      <SectionCard>
        <SectionHeader title="Typography" subtitle="Approved hierarchy and semantic tones" />
        <View style={styles.stackSmall}>
          <AppText variant="pageTitle">Page title</AppText>
          <AppText variant="sectionTitle">Section title</AppText>
          <AppText variant="bodyStrong">Strong body</AppText>
          <AppText tone="secondary">Supporting body copy</AppText>
          <AppText variant="metadata" tone="muted">Metadata · 20 Aug 2026</AppText>
        </View>
      </SectionCard>
      <PageSection title="Actions and feedback">
        <View style={styles.actionRow}>
          <AppButton label="Primary" icon="check" onPress={noop} />
          <AppButton label="Secondary" variant="secondary" onPress={noop} />
          <AppButton label="Disabled" disabled onPress={noop} />
        </View>
        <Banner title="Ready for review" tone="success" icon="check-circle">All required details are present.</Banner>
        <Banner title="Action required" tone="warning" icon="alert-triangle">One inspection expires this week.</Banner>
      </PageSection>
      <PageSection title="Status and navigation">
        <View style={styles.actionRow}>
          <StatusChip label="Approved" tone="approved" />
          <StatusChip label="Draft" tone="draft" />
          <StatusChip label="Maintenance" tone="maintenance" />
        </View>
        <BottomNavigationBar
          activeIndex={0}
          onSelect={noop}
          tabs={[
            { route: "/home", label: "Home", iconActive: "home", iconInactive: "home-outline" },
            { route: "/schedule", label: "Schedule", iconActive: "calendar", iconInactive: "calendar-outline" },
            { route: "/jobs", label: "Jobs", iconActive: "briefcase", iconInactive: "briefcase-outline" },
            { route: "/contacts", label: "Contacts", iconActive: "people", iconInactive: "people-outline" },
            { route: "/me", label: "Me", iconActive: "person", iconInactive: "person-outline" },
          ]}
        />
      </PageSection>
    </>
  );
}

function EmployeeListScenario() {
  return (
    <>
      <SectionCard>
        <SectionHeader title="Today" subtitle="Thursday 20 August" />
        <AppText variant="display">3</AppText>
        <AppText tone="secondary">assigned jobs</AppText>
      </SectionCard>
      <PageSection title="Upcoming work" subtitle="Your confirmed assignments">
        <ListRow title="Aurora · Unit move" subtitle="Pinewood Studios" metadata="07:30 · Transit AB12 CDE" leadingIcon="briefcase" status={<StatusChip label="Confirmed" tone="confirmed" />} onPress={noop} divider />
        <ListRow title="North Star · Tracking" subtitle="Longcross Studios" metadata="Tomorrow · 06:45" leadingIcon="map-pin" status={<StatusChip label="1st pencil" tone="first pencil" />} onPress={noop} divider />
        <ListRow title="Vehicle preparation" subtitle="Sprinter XY34 ZZZ" metadata="Due Friday" leadingIcon="truck" onPress={noop} />
      </PageSection>
      <StateView compact state="success" title="Timesheet up to date" message="No outstanding weeks." />
    </>
  );
}

function EmployeeFormScenario() {
  return (
    <PageSection title="Report a maintenance issue" subtitle="Continuous workflows use flat numbered steps">
      <FormStep number={1} title="Asset" hint="Choose what needs attention">
        <SelectField label="Vehicle" value="transit" onChange={noop} options={[{ label: "Transit · AB12 CDE", value: "transit" }]} />
      </FormStep>
      <FormStep number={2} title="Issue" hint="Include warning lights or symptoms">
        <FormField label="Description" value="Brake warning light appears intermittently" onChangeText={noop} multiline />
      </FormStep>
      <FormStep number={3} title="Review" last>
        <Checkbox checked onChange={noop} label="The vehicle is safe to leave parked" />
      </FormStep>
      <AppButton fullWidth label="Report issue" icon="send" onPress={noop} />
    </PageSection>
  );
}

function ServiceListScenario() {
  return (
    <>
      <View style={styles.metricsRow}>
        <SectionCard layoutStyle={styles.metricCard}><AppText variant="display">4</AppText><AppText tone="secondary">Overdue</AppText></SectionCard>
        <SectionCard layoutStyle={styles.metricCard}><AppText variant="display">7</AppText><AppText tone="secondary">Open defects</AppText></SectionCard>
      </View>
      <Banner title="Workshop priority" tone="danger" icon="alert-circle">Two vehicles leave within 24 hours.</Banner>
      <PageSection title="Priority work">
        <ListRow title="Transit · AB12 CDE" subtitle="Annual service overdue by 3 days" metadata="Workshop bay 2" leadingIcon="tool" status={<StatusChip label="Overdue" tone="danger" />} onPress={noop} divider />
        <ListRow title="Sprinter · XY34 ZZZ" subtitle="Tyre inspection" metadata="Leaves tomorrow 06:00" leadingIcon="truck" status={<StatusChip label="Due" tone="warning" />} onPress={noop} divider />
        <ListRow title="Discovery · LM56 NOP" subtitle="Preparation draft" metadata="Updated 09:42" leadingIcon="edit-3" status={<StatusChip label="Draft" tone="draft" />} onPress={noop} />
      </PageSection>
    </>
  );
}

function ServiceFormScenario() {
  return (
    <PageSection title="Workshop inspection" subtitle="Compact controls preserve 44pt targets">
      <FormField label="Vehicle" value="Transit · AB12 CDE" onChangeText={noop} disabled />
      <DateField label="Inspection date" value="2026-08-20" onChange={noop} />
      <SelectField label="Result" value="attention" onChange={noop} options={[
        { label: "Pass", value: "pass" },
        { label: "Needs attention", value: "attention" },
      ]} />
      <ToggleRow label="Vehicle grounded" description="Prevent assignment until resolved" value onChange={noop} />
      <FormField label="Workshop notes" value="Nearside front tyre below recommended tread depth." onChangeText={noop} multiline error="Record a replacement action before completion." />
      <View style={styles.actionRow}>
        <AppButton label="Save draft" variant="secondary" onPress={noop} layoutStyle={styles.grow} />
        <AppButton label="Complete" icon="check" onPress={noop} layoutStyle={styles.grow} />
      </View>
    </PageSection>
  );
}

export const VISUAL_SCENARIOS = Object.freeze({
  components: ComponentsScenario,
  "employee-list": EmployeeListScenario,
  "employee-form": EmployeeFormScenario,
  "service-list": ServiceListScenario,
  "service-form": ServiceFormScenario,
});

export function DesignSystemVisualFixture({ scenario }) {
  const Scenario = VISUAL_SCENARIOS[scenario] || ComponentsScenario;
  return <View testID="visual-scenario-ready" style={styles.fixture}><Scenario /></View>;
}

const styles = StyleSheet.create({
  fixture: { gap: t.spacing.md },
  stackSmall: { gap: t.spacing.xs },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: t.spacing.xs },
  metricsRow: { flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm },
  metricCard: { flexGrow: 1, minWidth: 132 },
  grow: { flexGrow: 1 },
});
