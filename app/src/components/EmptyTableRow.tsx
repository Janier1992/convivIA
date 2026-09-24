export function EmptyTableRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-muted-foreground">
        {message}
      </td>
    </tr>
  );
}
