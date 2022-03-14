export default {
  variants: {
    primary: ({ colorScheme = 'messenger' }) => ({
      color: `${colorScheme}.500`,
      _dark: {
        color: `${colorScheme}.300`,
      },
    }),
  },
  defaultProps: {
    variant: 'primary',
  },
};
