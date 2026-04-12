import RoomUI from "@/app/components/RoomUI";

export default async function Page({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return <RoomUI roomId={roomId} />;
}