from PIL import Image, ImageFilter
import tkinter as tk
from tkinter import filedialog

#Request the Path
root = tk.Tk()
root.withdraw()

#Read image
print("Please provide a file to convert.")
start_im = Image.open(filedialog.askopenfilename())

#Create a container for the final image
muted = (10, 10, 10)
final_size = (192, 96)
final_im = Image.new('RGB', final_size, color = muted)

#Modify the image
c_lor = (48, 0, 72, 24)
c_lol = (72, 0, 96, 24)
c_upr = (48, 24, 72, 48)
c_upl = (72, 24, 96, 48)
e_up = (24, 120, 72, 144)
e_lo = (24, 48, 72, 72)
e_ri = (72, 72, 96, 120)
e_le = (0, 72, 24, 120)
center = (24, 72, 72, 120)
retain = (0, 48, 96, 144)

fc_lor = (72, 72, 96, 96)
fc_lol = (0, 72, 24, 96)
fc_upr = (72, 0, 96, 24)
fc_upl = (0, 0, 24, 24)
fe_up = (24, 0, 72, 24)
fe_lo = (24, 72, 72, 96)
fe_ri = (0, 24, 24, 72)
fe_le = (72, 24, 96, 72)
fcenter = (24, 24, 72, 72)
fretain = (96, 0, 192, 96)

regions = [c_lor, c_lol, c_upr, c_upl, e_up, e_lo, e_ri, e_le, center, retain]
fregions = [fc_lor, fc_lol, fc_upr, fc_upl, fe_up, fe_lo, fe_ri, fe_le, fcenter, fretain]
chunks = list(range(10))
for i in range(len(regions)):
	chunks[i] = start_im.crop(regions[i])
	final_im.paste(chunks[i], fregions[i])

#Save the File
final_im.save('converted.png')