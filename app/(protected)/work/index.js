import { AppText as Text } from "../../../components/ui/AppPrimitives";
import { View } from "react-native";
import { staticColors } from "../../../lib/design/staticColors";
import { designTokens as t } from "../../../lib/design/tokens";
import PageShell from "../../../components/layout/PageShell";

export default function WorkPage() {
  return (
    <PageShell mode="static" width="full">
      <View style={{ flex: 1, backgroundColor: staticColors.hex_000_yhlkvq, justifyContent: "center", alignItems: "center" }}>
        <Text style={{ color: staticColors.hex_fff_yhjmu8, fontSize: t.typography.titleSmall.fontSize }}>📋 Work Page</Text>
      </View>
    </PageShell>
  );
}
