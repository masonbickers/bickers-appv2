import { StyleSheet, Text, type TextProps } from 'react-native';

import { useThemeColor } from '@/hooks/useThemeColor';
import { designTokens as t } from "../lib/design/tokens";
import { useTheme } from "../providers/ThemeProvider";

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?: 'default' | 'title' | 'defaultSemiBold' | 'subtitle' | 'link';
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = 'default',
  ...rest
}: ThemedTextProps) {
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');
  const { colors } = useTheme();

  return (
    <Text
      style={[
        { color: type === 'link' ? colors.link : color },
        type === 'default' ? styles.default : undefined,
        type === 'title' ? styles.title : undefined,
        type === 'defaultSemiBold' ? styles.defaultSemiBold : undefined,
        type === 'subtitle' ? styles.subtitle : undefined,
        type === 'link' ? styles.link : undefined,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: {
    fontSize: t.typography.bodyLarge.fontSize,
    lineHeight: t.typography.bodyLarge.lineHeight,
  },
  defaultSemiBold: {
    fontSize: t.typography.bodyLarge.fontSize,
    lineHeight: t.typography.bodyLarge.lineHeight,
    fontWeight: '600',
  },
  title: {
    fontSize: t.typography.display.fontSize,
    fontWeight: 'bold',
    lineHeight: t.typography.display.lineHeight,
  },
  subtitle: {
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: 'bold',
  },
  link: {
    lineHeight: t.typography.bodyLarge.lineHeight,
    fontSize: t.typography.bodyLarge.fontSize,
  },
});
