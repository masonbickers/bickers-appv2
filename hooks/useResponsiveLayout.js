import { useMemo } from "react";
import { useWindowDimensions } from "react-native";

import { getResponsiveLayout } from "../lib/design/responsive";

export function useResponsiveLayout() {
  const { width, height, fontScale } = useWindowDimensions();
  return useMemo(
    () => ({ ...getResponsiveLayout(width), height, fontScale }),
    [fontScale, height, width]
  );
}
