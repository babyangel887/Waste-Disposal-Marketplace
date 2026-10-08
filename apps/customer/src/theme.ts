import { StyleSheet } from 'react-native';

export const colors = {
  bg: '#f6f8f6',
  card: '#ffffff',
  text: '#1a2b1f',
  muted: '#5f6f63',
  primary: '#1c7a3d',
  danger: '#b3261e',
  border: '#dfe7e0',
};

export const theme = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 16,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginTop: 10,
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  msg: {
    marginTop: 12,
    fontSize: 13,
    color: colors.muted,
  },
  error: {
    marginTop: 12,
    fontSize: 13,
    color: colors.danger,
  },
  navButton: {
    marginBottom: 10,
  },
});
