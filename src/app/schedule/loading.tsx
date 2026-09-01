// Next.js показывает этот файл мгновенно при переходе на /schedule, пока
// страница грузит данные с сервера — без него на медленной сети тап по вкладке
// выглядит так, будто ничего не произошло, и человек нажимает ещё раз.
export default function ScheduleLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-6 w-40 rounded bg-slate-200" />
      <div className="h-40 rounded-2xl bg-slate-200" />
      <div className="h-6 w-40 rounded bg-slate-200" />
      <div className="h-40 rounded-2xl bg-slate-200" />
    </div>
  );
}
