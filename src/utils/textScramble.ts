const SCRAMBLE_CHARS = '!<>-_\\/[]{}—=+*^?#';
const INDEX_FOR_CORRECT_CHAR = 1000;

/**
 * Generate a random character from the set above.
 * @returns random string character from above selection
 */
const getRandomChar = () => {
  const len = SCRAMBLE_CHARS.length;
  return SCRAMBLE_CHARS[Math.floor(len * Math.random())];
};

/**
 * Generates a random string between 5 and textLength characters long.
 * It uses the getRandomChar function to generate random characters
 * in the string.
 *
 * @param textLength length of the text to render
 * @returns string of random charaters
 */
export const getRandomString = (textLength: number) => {
  const randomStringLength = Math.floor(
    Math.random() * (textLength - 5 + 1) + 5,
  );

  return Array(randomStringLength)
    .fill('')
    .map(() => getRandomChar())
    .join('');
};

/**
 * getNewText will generate a new randomized text string based on
 * the iteration count, the old string, and the final string we want to generate.
 *
 * @param count number, count of iterations so far
 * @param oldText random text string
 * @param finalText the final text string we want to render
 * @returns
 */
export const getNewText = (
  count: number,
  oldText: string,
  finalText: string,
) => {
  const newTextArr = finalText.split('').map((char, i) => {
    if (oldText.charAt(i) === char) {
      return char;
    }

    if (Math.random() * INDEX_FOR_CORRECT_CHAR < count) {
      return char;
    }

    if (Math.random() * INDEX_FOR_CORRECT_CHAR > i) {
      if (!oldText[i] || Math.random() < 0.2) {
        return getRandomChar();
      }
    }

    return oldText[i] ?? '';
  });

  return newTextArr.join('');
};
