import React, { useState, useRef } from 'react';
import {
  View, TextInput, TouchableOpacity, StyleSheet, Keyboard, Text,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSpring,
} from 'react-native-reanimated';
import Svg, { Path, Circle } from 'react-native-svg';

interface Props {
  onSearch: (city: string) => void;
  isLight: boolean;
  loading: boolean;
}

function SearchIcon({ color }: { color: string }) {
  return (
    <Svg width="18" height="18" viewBox="0 0 24 24">
      <Circle cx="11" cy="11" r="7" fill="none" stroke={color} strokeWidth="2.5" />
      <Path d="M16.5,16.5 L21,21" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </Svg>
  );
}

export default function SearchBar({ onSearch, isLight, loading }: Props) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const scale = useSharedValue(1);

  const handleSubmit = () => {
    const trimmed = query.trim();
    if (trimmed) {
      Keyboard.dismiss();
      onSearch(trimmed);
      scale.value = withSpring(0.95, {}, () => {
        scale.value = withSpring(1);
      });
    }
  };

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const textColor = isLight ? '#1a1a2e' : '#ffffff';
  const placeholderColor = isLight ? 'rgba(26,26,46,0.4)' : 'rgba(255,255,255,0.5)';
  const iconColor = isLight ? '#555' : 'rgba(255,255,255,0.7)';

  return (
    <Animated.View style={[styles.wrapper, animStyle]}>
      <BlurView
        intensity={focused ? 30 : 20}
        tint={isLight ? 'light' : 'dark'}
        style={styles.blur}
      >
        <View style={styles.inner}>
          <SearchIcon color={iconColor} />
          <TextInput
            style={[styles.input, { color: textColor }]}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSubmit}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search city..."
            placeholderTextColor={placeholderColor}
            returnKeyType="search"
            autoCapitalize="words"
            autoCorrect={false}
          />
          {loading && (
            <Text style={{ color: iconColor, fontSize: 12 }}>...</Text>
          )}
          {query.length > 0 && !loading && (
            <TouchableOpacity onPress={() => setQuery('')} style={styles.clear}>
              <Text style={{ color: iconColor, fontSize: 16, lineHeight: 18 }}>×</Text>
            </TouchableOpacity>
          )}
        </View>
      </BlurView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 20,
    overflow: 'hidden',
  },
  blur: {
    borderRadius: 20,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    padding: 0,
  },
  clear: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
