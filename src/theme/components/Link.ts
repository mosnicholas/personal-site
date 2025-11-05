export default {
  variants: {
    primary: ({ colorScheme = 'gray' }) => ({
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
