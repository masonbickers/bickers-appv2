import type { ReactNode } from "react";
import { View } from "react-native";

import { useTheme } from "../../providers/ThemeProvider";

export default function RootSurface({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={{ flex: 1, backgroundColor: colors.background }}>{children}</View>;
}

