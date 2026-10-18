import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'

/** Markdown with $math$ — used for AI answers. Raw HTML is not rendered. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="answer">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
