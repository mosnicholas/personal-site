export const TAGLINE = 'adventurer, cook, and founder of Junior';

type TaglineProps = {
  className?: string;
  linkClassName?: string;
};

const Tagline = ({ className, linkClassName }: TaglineProps) => (
  <div className={className}>
    adventurer, cook, and founder of{' '}
    <a
      href="https://myjunior.ai"
      target="_blank"
      rel="noopener noreferrer"
      className={linkClassName}
    >
      Junior
    </a>
  </div>
);

export default Tagline;
