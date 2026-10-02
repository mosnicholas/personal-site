const THIS_YEAR = new Date().getFullYear();

const numberFormat = new Intl.NumberFormat('en-US');

export const formatCount = (n: number) => numberFormat.format(n);

/** "1 document", "1,024 documents" */
export const plural = (n: number, word: string) =>
  `${formatCount(n)} ${word}${n === 1 ? '' : 's'}`;

const shortDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});
const longDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** "Oct 4" this year, "Oct 4, 2025" otherwise; '' for an unparseable value */
export const formatDate = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return (date.getFullYear() === THIS_YEAR ? shortDate : longDate).format(date);
};

/** Timeline weeks are calendar dates ('YYYY-MM-DD'), so read them in UTC */
export const parseWeek = (week: string) => new Date(`${week}T00:00:00Z`);

const weekFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const monthFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  timeZone: 'UTC',
});

export const formatWeek = (week: string) => weekFormat.format(parseWeek(week));
export const formatMonth = (date: Date) => monthFormat.format(date);

/** Hostname without "www.", for documents with no site name */
export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
