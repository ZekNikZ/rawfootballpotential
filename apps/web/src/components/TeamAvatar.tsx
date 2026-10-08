import { Avatar } from "@mantine/core";

/** A team's logo, falling back to its initials. */
export function TeamAvatar({
  src,
  name,
  size = 24,
}: {
  src: string | null | undefined;
  name: string | undefined;
  size?: number;
}) {
  return (
    <Avatar
      src={src ?? undefined}
      name={name}
      color="initials"
      radius="sm"
      size={size}
      style={{ flexShrink: 0 }}
    />
  );
}
