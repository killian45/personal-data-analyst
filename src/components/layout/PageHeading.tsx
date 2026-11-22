/** Title and short description at the top of each page. */

interface PageHeadingProps {
  title: string
  description: string
}

export function PageHeading({
  title,
  description,
}: PageHeadingProps) {
  return (
    <div className="mb-8">
      <h2 className="text-2xl font-bold tracking-tight">
        {title}
      </h2>

      <p className="mt-2 text-sm text-slate-500">
        {description}
      </p>
    </div>
  )
}
