type WebsiteLinkIconProps = {
  className?: string;
};

export function WebsiteLinkIcon({ className }: WebsiteLinkIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      data-token-link-icon="website"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 20 20"
    >
      <circle cx="10" cy="10" r="8.1" />
      <path d="M1.9 10h16.2" />
      <path d="M10 1.9C7.83 4.2 6.75 6.9 6.75 10S7.83 15.8 10 18.1" />
      <path d="M10 1.9c2.17 2.3 3.25 5 3.25 8.1S12.17 15.8 10 18.1" />
    </svg>
  );
}
