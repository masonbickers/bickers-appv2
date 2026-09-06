import { Image } from "react-native";

import { designTokens as t } from "../../lib/design/tokens";

type BrandArtworkProps = {
  variant?: "login" | "header";
  accessibilityLabel?: string;
};

export default function BrandArtwork({
  variant = "header",
  accessibilityLabel = "Bickers Action logo",
}: BrandArtworkProps) {
  const dimensions = variant === "login"
    ? { width: 220, height: 80, marginBottom: t.spacing.xl }
    : { width: 132, height: 48 };
  return (
    <Image
      accessibilityLabel={accessibilityLabel}
      source={require("../../assets/images/bickers-action-logo.png")}
      resizeMode="contain"
      style={dimensions}
    />
  );
}

