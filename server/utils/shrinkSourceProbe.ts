import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { assessShrinkSourceCodec, type ShrinkSourceCodecAssessment } from '#shared/shrinkSourceCodec'

const execFileAsync = promisify(execFile)

export async function probeVideoCodecName(videoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        videoPath,
      ],
      { windowsHide: true, maxBuffer: 1 << 20 },
    )
    const name = String(stdout).trim()
    return name || null
  } catch {
    return null
  }
}

export async function assessShrinkSourceFile(
  videoPath: string,
): Promise<ShrinkSourceCodecAssessment> {
  const codec = await probeVideoCodecName(videoPath)
  return assessShrinkSourceCodec(codec)
}
