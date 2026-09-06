import { useCallback, useMemo, useRef } from "react";
import { PanResponder, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useTheme } from "../../providers/ThemeProvider";
import { designTokens as t } from "../../lib/design/tokens";
import { AppPressable, AppText } from "./AppPrimitives";

const POINT_SPACING = 2;
const PATH_LIMIT = 11000;
const SIGNATURE_PAD_HEIGHT = 180;
const SIGNATURE_HINT_TOP = 78;

export default function SignatureField({
  label = "Signature",
  value,
  onChange,
  onDrawingStateChange,
  disabled = false,
  layoutStyle,
}) {
  const { colors } = useTheme();
  const drawingRef = useRef(value || "");
  const lastPointRef = useRef(null);

  const appendPoint = useCallback((prefix, event) => {
    const { locationX, locationY } = event.nativeEvent;
    if (!Number.isFinite(locationX) || !Number.isFinite(locationY)) return;

    const point = { x: Math.round(locationX), y: Math.round(locationY) };
    const lastPoint = lastPointRef.current;
    if (prefix === "L" && lastPoint && Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) < POINT_SPACING) return;

    const command = `${prefix} ${point.x} ${point.y}`;
    const nextPath = drawingRef.current ? `${drawingRef.current} ${command}` : command;
    if (nextPath.length > PATH_LIMIT) return;

    lastPointRef.current = point;
    drawingRef.current = nextPath;
    onChange?.(nextPath);
  }, [onChange]);

  const finishDrawing = useCallback(() => {
    lastPointRef.current = null;
    onDrawingStateChange?.(false);
  }, [onDrawingStateChange]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder: () => !disabled,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (event) => {
      onDrawingStateChange?.(true);
      appendPoint("M", event);
    },
    onPanResponderMove: (event) => appendPoint("L", event),
    onPanResponderRelease: finishDrawing,
    onPanResponderTerminate: finishDrawing,
  }), [appendPoint, disabled, finishDrawing, onDrawingStateChange]);

  const clear = () => {
    drawingRef.current = "";
    lastPointRef.current = null;
    onChange?.("");
  };

  return (
    <View style={layoutStyle}>
      <AppText variant="formLabel" layoutStyle={styles.label}>{label}</AppText>
      <View
        accessibilityLabel={`${label} drawing area`}
        accessibilityState={{ disabled }}
        style={[
          styles.pad,
          { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
          disabled && styles.disabled,
        ]}
        {...panResponder.panHandlers}
      >
        <Svg width="100%" height="100%" pointerEvents="none">
          <Path d={value} fill="none" stroke={colors.text} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
        {!value ? <AppText tone="muted" layoutStyle={styles.hint}>Draw your signature here</AppText> : null}
      </View>
      <AppPressable accessibilityRole="button" disabled={!value || disabled} onPress={clear} style={styles.clear}>
        <AppText variant="link">Clear signature</AppText>
      </AppPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { marginBottom: t.spacing.xs },
  pad: {
    height: SIGNATURE_PAD_HEIGHT,
    borderWidth: 1,
    borderRadius: t.radius.md,
    overflow: "hidden",
  },
  disabled: { opacity: t.opacity.disabled },
  hint: { position: "absolute", alignSelf: "center", top: SIGNATURE_HINT_TOP },
  clear: { alignSelf: "flex-end", marginTop: t.spacing.xs },
});
