import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Menu } from 'lucide-react-native';
import { useNavigation } from 'expo-router';
import { spacing, borderRadius, typography } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';

interface ScreenHeaderProps {
  title?: string;
  centerComponent?: React.ReactNode;
  rightComponent?: React.ReactNode;
  showBorder?: boolean;
}

export function ScreenHeader({ 
  title, 
  centerComponent, 
  rightComponent,
  showBorder = false,
}: ScreenHeaderProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const openDrawer = () => {
    // Structural drawer action — avoids importing a second react-navigation
    // copy (expo-router 57 vendors its own).
    navigation.dispatch({ type: 'OPEN_DRAWER' });
  };

  return (
    <View style={[
      styles.container, 
      { paddingTop: insets.top + spacing.sm },
      showBorder && styles.withBorder,
    ]}>
      <View style={styles.content}>
        <TouchableOpacity 
          style={styles.menuButton} 
          onPress={openDrawer}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Menu size={22} color={colors.textSecondary} strokeWidth={1.5} />
        </TouchableOpacity>
        
        <View style={styles.centerContainer}>
          {centerComponent ? centerComponent : title ? (
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
          ) : null}
        </View>
        
        <View style={styles.rightContainer}>
          {rightComponent || <View style={styles.placeholder} />}
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    backgroundColor: colors.background,
    zIndex: 10,
  },
  withBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    height: 56,
  },
  menuButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.md,
  },
  title: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  rightContainer: {
    minWidth: 40,
    alignItems: 'flex-end',
  },
  placeholder: {
    width: 40,
    height: 40,
  },
}));
